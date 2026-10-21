// Zrzuty dema kreatora kadłuba (dema/kreator-kadluba-webgpu.html) w headless Chrome z GPU (CDP), klatki z zegarem
// ręcznym (?test=1 → __kreator.runFrames): projekt po otwarciu, flota Terra Novy A/B z jej sprite'ami (ten sam okręt,
// ta sama skala: oba w kadrze, kadr na okręt, zoom 1 i zbliżenie ×3 przy rufie), pozostałe projekty A/B z kadłubem
// podobnej klasy w zoomach 0,22 / 0,5 / 1, style rogów (fazy / łuki / ostro), mapy pakietu (albedo, normalne, AO,
// relief, emisja, komórki belek), okręty z gotowych części, edycja (blok, koło, wycięcie, moduł, naklejka, rowek
// myszą), sieć rur (etap `rury`: rufa z gondolami A/B, sieć wyłączona, rura ręczna), pipeline'y synchroniczne
// w klatkach (ma być 0), błędy konsoli. Etap `klocki` (poza domyślnymi): fregata z klocków, arkusz palety, edycja myszą
// (`--etapy klocki --tylko klocki` — bez floty).
//
//   node scripts/webgpu/kreator-kadluba-demo.mjs [--out .tmp/kreator/demo] [--rozmiar 1600x900] [--tylko citadella,orbis]
//        [--etapy ab,rury,style,mapy,czesci,edycja,klocki,reaktor]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/kreator/demo');
const only = args.tylko ? new Set(String(args.tylko).split(',')) : null;
const stages = new Set(String(args.etapy || 'ab,rury,style,mapy,czesci,edycja').split(','));
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5431));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const report = { zrzuty: {} };

async function shot(name, opis, frames = 4) {
  await ev('window.__kreator.built()');
  await ev(`window.__kreator.runFrames(${frames}, 60)`);
  // mapa powierzchni nowego kadłuba (HullSurface) wysyła się w wolnej chwili — zrzut dopiero z nią
  for (let k = 0; k < 30 && !(await ev('window.__kreator.stats().surfaceReady')); k++) await ev('window.__kreator.runFrames(4, 60)');
  await screenshotPng(cdp, join(out, `${name}.png`));
  const st = await ev('window.__kreator.stats()');
  report.zrzuty[name] = { opis, ...st };
  console.log('zrzut', name.padEnd(30), JSON.stringify({ img: st.image, nodes: st.nodes, t: st.timing && Math.round(st.timing.total), sync: st.syncPipes, siec: st.net }));
}

const PRESETS = ['custos', 'hasta', 'bellator', 'citadella', 'colossus', 'orbis', 'atlas2', 'pirate'];
const TN = new Set(['custos', 'hasta', 'bellator', 'citadella', 'colossus']);
try {
  await cdp.send('Page.navigate', { url: `${base}/dema/kreator-kadluba-webgpu.html?test=1` });
  if (!await waitFor(cdp, '!!(window.__kreator && (window.__kreator.ready || window.__kreator.error))', 240000, 400)) throw new Error('demo nie wstało');
  const err = await ev('window.__kreator.error || null');
  if (err) throw new Error(`demo: ${err}`);
  await shot('00-otwarcie', 'Po otwarciu: krążownik Orbis (koło w środku), styl zaokrąglony, panel edytora');
  for (const key of PRESETS) {
    if (only && !only.has(key)) continue;
    await ev(`window.__kreator.preset(${JSON.stringify(key)})`);
    await ev('document.body.classList.add("clean")');
    if (stages.has('ab') && TN.has(key)) {
      // A/B tego samego okrętu: projekt (góra) i sprite gry (dół), w kadrze oba; potem zbliżenia na kadr okrętu
      await ev('window.__kreator.built()');
      await ev('window.__kreator.fitAb()');
      await shot(`${key}-ab`, `${key}: kreator (góra) i sprite gry (dół), ta sama skala`);
      const fitZ = await ev('(() => { const k = window.__kreator; const im = k.S.field.image; return Math.min(innerWidth * 0.85 / im.w, innerHeight * 0.8 / im.h); })()');
      for (const [tag, z] of [['fit', fitZ], ['gra1', 1], ['det', fitZ * 3]]) {
        // zbliżenie: kadr na ćwiartkę od rufy (sprzęt, rury, panele)
        const dx = tag === 'det' ? `-(window.__kreator.S.field.image.w * 0.22)` : '0';
        await ev(`window.__kreator.setAb(true, "design"); window.__kreator.setZoom(${z}); window.__kreator.S.cam.x += ${dx}; window.__kreator.S.cam.y -= ${tag === 'det' ? 'window.__kreator.S.field.image.h * 0.18' : '0'}`);
        await shot(`${key}-a-${tag}`, `${key}: A — kreator, zoom ${z.toFixed(2)}`);
        await ev(`window.__kreator.setAb(true, "ref"); window.__kreator.setZoom(${z}); window.__kreator.S.cam.x += ${dx}; window.__kreator.S.cam.y -= ${tag === 'det' ? 'window.__kreator.S.field.image.h * 0.18' : '0'}`);
        await shot(`${key}-b-${tag}`, `${key}: B — sprite gry, zoom ${z.toFixed(2)}`);
      }
      await ev('window.__kreator.setAb(false)');
    } else if (stages.has('ab')) {
      await ev('window.__kreator.setAb(true, "design")');
      await ev('window.__kreator.setZoom(0.22)');
      await ev('window.__kreator.setCamera(window.__kreator.S.cam.x, (window.__kreator.ship.y + window.__kreator.ref.y) / 2, 0.22)');
      await shot(`${key}-ab-022`, `${key}: kreator (góra) i dzisiejszy sprite (dół), zoom 0,22`);
      for (const z of [0.5, 1]) {
        const tag = String(z).replace('.', '');
        await ev(`window.__kreator.setAb(true, "design"); window.__kreator.setZoom(${z})`);
        await shot(`${key}-a-${tag}`, `${key}: A — kreator, zoom ${z}`);
        await ev(`window.__kreator.setAb(true, "ref"); window.__kreator.setZoom(${z})`);
        await shot(`${key}-b-${tag}`, `${key}: B — dzisiejszy sprite, zoom ${z}`);
      }
      await ev('window.__kreator.setAb(false)');
    }
    if (stages.has('rury') && TN.has(key)) {
      // sieć rur: rufa z gondolami (oś okrętu, ~⅓ długości od rufy) A/B, ta sama klatka bez sieci (gęstość 0)
      await ev('window.__kreator.built()');
      const fitZ = await ev('(() => { const k = window.__kreator; const im = k.S.field.image; return Math.min(innerWidth * 0.85 / im.w, innerHeight * 0.8 / im.h); })()');
      const z = fitZ * 2.4;
      const dx = '-(window.__kreator.S.field.image.w * 0.33)';
      for (const side of ['design', 'ref']) {
        await ev(`window.__kreator.setAb(true, ${JSON.stringify(side)}); window.__kreator.setZoom(${z}); window.__kreator.S.cam.x += ${dx}`);
        await shot(`${key}-${side === 'design' ? 'a' : 'b'}-rufa`, `${key}: ${side === 'design' ? 'A — kreator z siecią rur' : 'B — sprite gry'}, rufa, zoom ${z.toFixed(2)}`);
      }
      if (key === 'citadella') {
        // kadr zgłoszenia użytkownika (2026-10-20): gondole MAIN, kolumna z napisem TERRA NOVA, kasztele — zoom 3,3;
        // czysty i z nakładką edytora (obrysy modułów, graf sieci systemów)
        await ev('window.__kreator.setAb(false); window.__kreator.setCamera(-362, -65, 3.3)');
        await shot(`${key}-a-zgloszenie`, `${key}: kadr zgłoszenia (rufa: gondole, kolumna TERRA NOVA, kasztele), zoom 3,3`);
        await ev('document.body.classList.remove("clean"); window.__kreator.setNetGraph?.(true); window.__kreator.setCamera(-362, -65, 3.3)');
        await shot(`${key}-a-zgloszenie-edytor`, `${key}: kadr zgłoszenia z nakładką edytora i grafem sieci (I)`);
        await ev('window.__kreator.setNetGraph?.(false); document.body.classList.add("clean")');
      }
      const dens = await ev('window.__kreator.design.pipeNet?.density ?? 0');
      await ev('window.__kreator.edit((d) => { d.pipeNet = { ...(d.pipeNet || {}), density: 0 }; })');
      await ev(`window.__kreator.setAb(true, "design"); window.__kreator.setZoom(${z}); window.__kreator.S.cam.x += ${dx}`);
      await shot(`${key}-a-rufa-bez`, `${key}: A — kreator BEZ sieci rur (dawna maszynownia), rufa`);
      await ev(`window.__kreator.edit((d) => { d.pipeNet = { ...(d.pipeNet || {}), density: ${dens} }; })`);
      await ev('window.__kreator.built()');
      await ev('window.__kreator.setAb(false)');
    }
    if (stages.has('reaktor') && TN.has(key)) {
      // gniazdo obudowy reaktora (moduł reactor v 2) z modelem 3D gry (reactor3D) i bez niego — samo gniazdo w poszyciu
      await ev('window.__kreator.built()');
      const rc = await ev('(() => { const m = window.__kreator.S.field.expanded.modules.find((q) => q.type === "reactor"); return m ? { x: m.x, y: m.y, r: m.r, v: m.v } : null; })()');
      if (rc) {
        const z = Math.min(12, 140 / rc.r);
        report.reaktor = report.reaktor || {};
        report.reaktor[key] = { ...rc, model: await ev('window.__kreator.reactor3D ? window.__kreator.reactor3D.stats.instances : -1') };
        await ev(`window.__kreator.setAb(false); window.__kreator.setCamera(${rc.x}, ${rc.y}, ${z})`);
        await ev('window.__kreator.runFrames(4)');
        await shot(`${key}-reaktor-3d`, `${key}: obudowa reaktora 3D w gnieździe (v ${rc.v}), zoom ${z.toFixed(2)}`);
        await ev('window.__kreator.reactor3D.debug.enabled = false; window.__kreator.runFrames(2)');
        await shot(`${key}-reaktor-gniazdo`, `${key}: samo gniazdo obudowy w poszyciu (bez modelu 3D)`);
        await ev('window.__kreator.reactor3D.debug.enabled = true');
        await ev(`window.__kreator.setCamera(${rc.x}, ${rc.y}, ${z * 0.3})`);
        await ev('window.__kreator.runFrames(4)');
        await shot(`${key}-reaktor-okret`, `${key}: obudowa reaktora na tle okrętu, zoom ${(z * 0.3).toFixed(2)}`);
      }
    }
    if (stages.has('style') && key === 'orbis') {
      for (const s of ['chamfer', 'rounded', 'sharp']) {
        await ev(`window.__kreator.setStyle(${JSON.stringify(s)})`);
        await ev('window.__kreator.built()');
        await ev('window.__kreator.fit()');
        await shot(`${key}-styl-${s}`, `${key}: styl ${s}`);
      }
      await ev('window.__kreator.setStyle("rounded")');
    }
    if (stages.has('mapy') && (key === 'orbis' || key === 'atlas2' || String(args.mapyDla || '').split(',').includes(key))) {
      await ev('window.__kreator.fit()');
      for (const v of ['albedo', 'normal', 'ao', 'relief', 'emis', 'cells']) {
        await ev(`window.__kreator.setView(${JSON.stringify(v)})`);
        await shot(`${key}-mapa-${v}`, `${key}: mapa ${v}`);
      }
      await ev('window.__kreator.setView("game")');
    }
    await ev('document.body.classList.remove("clean")');
  }
  if (stages.has('czesci')) {
    for (const key of ['tnparts', 'tnparts2']) {
      await ev(`window.__kreator.preset(${JSON.stringify(key)})`);
      await ev('window.__kreator.fit()');
      await shot(`czesci-${key}-edytor`, `${key}: okręt z gotowych części — widok edytora (pudła części)`);
      await ev('document.body.classList.add("clean")');
      await ev('window.__kreator.fit()');
      await shot(`czesci-${key}`, `${key}: okręt z gotowych części`);
      await ev('document.body.classList.remove("clean")');
    }
  }
  if (stages.has('edycja')) {
    await ev('window.__kreator.preset("destroyer")');
    await ev('window.__kreator.fit()');
    await shot('edycja-0-przed', 'Edycja: niszczyciel przed zmianami');
    await ev(`window.__kreator.edit((d) => {
      d.blocks.push([4, -1, 0], [-5, -1, 0], [1, -2, 0]);
      d.shapes.push({ kind: 'circle', op: 'add', x: 90, y: 0, r: 52, level: 1 }, { kind: 'circle', op: 'cut', x: 90, y: 0, r: 30, level: 1 });
      d.modules.push({ type: 'turret_s', x: 90, y: -98, rot: 0, r: 11 });
      d.decals.push({ kind: 'emblem', id: 'bolt', x: -150, y: -42, rot: 0, w: 30, h: 30, color: '#ffb54a', opacity: 0.95, flip: false });
    })`);
    await shot('edycja-1-po', 'Edycja: +bloki (dziób, rufa, sponson), pierścień nadbudówki (koło + wycięcie), wieża S, emblemat');
    // Edycja myszą (zdarzenia CDP): malowanie bloków LPM, usunięcie modułu PPM, koło przeciągnięciem.
    const mouse = async (type, x, y, button = 'left', buttons = 1) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: 1 });
    const scr = async (x, y) => ev(`window.__kreator.toScreen(${x}, ${y})`);
    const count = () => ev('({ b: window.__kreator.design.blocks.length, m: window.__kreator.design.modules.length, s: window.__kreator.design.shapes.length })');
    report.mysz = { przed: await count() };
    await ev('window.__kreator.act("b"); window.__kreator.act("2")');   // bloki pancerza
    let a = await scr(-30, -150), b = await scr(210, -150);
    await mouse('mouseMoved', a.x, a.y, 'none', 0);
    await mouse('mousePressed', a.x, a.y);
    for (let k = 1; k <= 12; k++) await mouse('mouseMoved', a.x + (b.x - a.x) * k / 12, a.y, 'left', 1);
    await mouse('mouseReleased', b.x, b.y);
    await ev('window.__kreator.built()');
    report.mysz.malowanie = await count();
    const t = await ev('(() => { const m = window.__kreator.design.modules.find((x) => x.type === "turret_s"); return m ? { x: m.x, y: m.y } : null; })()');
    if (t) {
      a = await scr(t.x, t.y);
      await mouse('mouseMoved', a.x, a.y, 'none', 0);
      await mouse('mousePressed', a.x, a.y, 'right', 2);
      await mouse('mouseReleased', a.x, a.y, 'right', 0);
      await ev('window.__kreator.built()');
    }
    report.mysz.ppm = await count();
    await ev('window.__kreator.act("c"); window.__kreator.act("3")');   // koło nadbudówki
    a = await scr(-200, 0); b = await scr(-200, 40);
    await mouse('mouseMoved', a.x, a.y, 'none', 0);
    await mouse('mousePressed', a.x, a.y);
    for (let k = 1; k <= 6; k++) await mouse('mouseMoved', a.x, a.y + (b.y - a.y) * k / 6, 'left', 1);
    await mouse('mouseReleased', b.x, b.y);
    await ev('window.__kreator.built()');
    report.mysz.kolo = await count();
    // rowek myszą: R, trzy punkty LPM, PPM kończy
    await ev('window.__kreator.act("r")');
    const gp = [[-150, -40], [-40, -40], [20, -10]];
    for (const [x, y] of gp) {
      a = await scr(x, y);
      await mouse('mouseMoved', a.x, a.y, 'none', 0);
      await mouse('mousePressed', a.x, a.y);
      await mouse('mouseReleased', a.x, a.y);
    }
    await mouse('mousePressed', a.x, a.y, 'right', 2);
    await mouse('mouseReleased', a.x, a.y, 'right', 0);
    await ev('window.__kreator.built()');
    report.mysz.rowek = await ev('(window.__kreator.design.grooves || []).length');
    // rura ręczna myszą: W, trzy punkty LPM (przez rów i po płycie), PPM kończy
    await ev('window.__kreator.act("w")');
    for (const [x, y] of [[-230, -20], [-120, -20], [-60, -48]]) {
      a = await scr(x, y);
      await mouse('mouseMoved', a.x, a.y, 'none', 0);
      await mouse('mousePressed', a.x, a.y);
      await mouse('mouseReleased', a.x, a.y);
    }
    await mouse('mousePressed', a.x, a.y, 'right', 2);
    await mouse('mouseReleased', a.x, a.y, 'right', 0);
    await ev('window.__kreator.built()');
    report.mysz.rura = await ev('(window.__kreator.design.pipes || []).length');
    console.log('mysz', JSON.stringify(report.mysz));
    await shot('edycja-2-mysz', 'Edycja myszą: pas bloków pancerza nad burtą, wieża S usunięta PPM, koło nadbudówki na rufie, rowek, rura ręczna');
  }
  if (stages.has('klocki')) {
    // KLOCKI (--etapy klocki): fregata z klocków (edytor z paletą i zaznaczonym klinem, czysty kadr, zoom gry 1,
    // zbliżenie rufy, A/B ze sprite'em Custosa), arkusz palety (każdy kształt 0° / 45° / 90° z odbiciem, szczelina,
    // wycięcie, nadbudówka), edycja myszą (stawianie klikiem i przeciąganiem, obrót R, cofanie i ponawianie)
    const k = 'window.__kreator';
    await ev(`${k}.preset("klocki")`);
    // kadr: okręt w lewej części ekranu (panel po prawej), sekcja klocków panelu widoczna
    await ev(`${k}.blk.tool(); ${k}.blk.select([6]); (() => { const im = ${k}.S.field.image; const z = Math.min((innerWidth - 360) * 0.86 / im.w, innerHeight * 0.7 / im.h); ${k}.setCamera(im.cx + 170 / z, im.cy, z); })(); document.getElementById('blk-palette').scrollIntoView({ block: 'start' })`);
    await shot('klocki-edytor', 'Fregata z klocków: edytor — paleta, obrysy klocków (lustro przerywane), oś lustra, uchwyty klina');
    await ev(`${k}.blk.select([]); ${k}.act("v"); document.body.classList.add("clean")`);
    const fitZ = await ev(`(() => { const im = ${k}.S.field.image; return Math.min(innerWidth * 0.85 / im.w, innerHeight * 0.8 / im.h); })()`);
    await ev(`${k}.setCamera(${k}.S.field.image.cx, ${k}.S.field.image.cy, ${fitZ})`);
    await shot('klocki-fregata', 'Fregata z klocków (10 klocków + lustro): kadr na okręt');
    await ev(`${k}.setCamera(${k}.S.field.image.cx - ${k}.S.field.image.w * 0.25, ${k}.S.field.image.cy - ${k}.S.field.image.h * 0.15, ${fitZ * 2.6})`);
    await shot('klocki-fregata-det', 'Fregata z klocków: zbliżenie rufy (rowy maszynowni z rurami między płytami)');
    await ev(`${k}.setCamera(${k}.S.field.image.cx, ${k}.S.field.image.cy, 1)`);
    await shot('klocki-fregata-gra1', 'Fregata z klocków: zoom gry 1');
    await ev(`${k}.fitAb()`);
    await shot('klocki-ab', 'Fregata z klocków (góra) i sprite Custosa (dół), ta sama skala');
    await ev(`${k}.setAb(false); ${k}.blk.sheet()`);
    await ev(`${k}.built()`);
    const sheetZ = await ev(`(() => { const im = ${k}.S.field.image; return Math.min(innerWidth * 0.92 / im.w, innerHeight * 0.85 / im.h); })()`);
    await ev(`${k}.setCamera(${k}.S.field.image.cx, ${k}.S.field.image.cy, ${sheetZ})`);
    await shot('klocki-paleta', 'Arkusz palety: rzędy 0°, 45°, 90° z odbiciem; dół — rowy między płytami, gap 0, nakładanie, wycięcie, nadbudówka');
    await ev(`document.body.classList.remove("clean"); ${k}.blk.tool(); ${k}.setCamera(${k}.S.field.image.cx + 180 / (${sheetZ} * 0.74), ${k}.S.field.image.cy, ${sheetZ * 0.74}); document.getElementById('blk-palette').scrollIntoView({ block: 'start' })`);
    await shot('klocki-paleta-edytor', 'Arkusz palety w edytorze: panel klocków, obrysy klocków');
    // edycja myszą na fregacie
    await ev(`${k}.preset("klocki")`);
    await ev(`${k}.blk.tool(); (() => { const im = ${k}.S.field.image; const z = Math.min((innerWidth - 360) * 0.86 / im.w, innerHeight * 0.7 / im.h); ${k}.setCamera(im.cx + 170 / z, im.cy, z); })()`);
    const mouse = async (type, x, y, button = 'left', buttons = 1, modifiers = 0) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: 1, modifiers });
    const key = async (keyName, code, modifiers = 0) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, modifiers, windowsVirtualKeyCode: keyName.toUpperCase().charCodeAt(0) });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, modifiers, windowsVirtualKeyCode: keyName.toUpperCase().charCodeAt(0) });
    };
    const scr = async (x, y) => ev(`${k}.toScreen(${x}, ${y})`);
    const st = () => ev(`({ n: ${k}.blk.count(), hist: ${k}.blk.hist(), sel: ${k}.S.blkSel.size, rot: [...${k}.S.blkSel].map((b) => Math.round(b.rot * 180 / Math.PI)) })`);
    const mk = { przed: await st() };
    await ev(`${k}.blk.palette("wedge"); ${k}.act("2")`);
    let a = await scr(4, -26);
    await mouse('mouseMoved', a.x, a.y, 'none', 0);
    await mouse('mousePressed', a.x, a.y);
    await mouse('mouseReleased', a.x, a.y);
    await ev(`${k}.built()`);
    mk.klik = await st();
    await ev(`${k}.blk.palette("trap_r")`);
    a = await scr(-30, -34); const b = await scr(-12, -24);
    await mouse('mouseMoved', a.x, a.y, 'none', 0);
    await mouse('mousePressed', a.x, a.y);
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8, 'left', 1);
    await mouse('mouseReleased', b.x, b.y);
    await ev(`${k}.built()`);
    mk.przeciaganie = await st();
    await key('r', 'KeyR');
    await ev(`${k}.built()`);
    mk.obrot = await st();
    await key('z', 'KeyZ', 2);
    await ev(`${k}.built()`);
    mk.cofnij = await st();
    await key('y', 'KeyY', 2);
    await ev(`${k}.built()`);
    mk.ponow = await st();
    report.mysz_klocki = mk;
    console.log('klocki mysz', JSON.stringify(mk));
    await shot('klocki-edycja-mysz', 'Edycja myszą: klin (klik) nad burtą, trapez przeciąganiem nad rufą, obrót R, cofnij / ponów');
    // spójność ramy w panelu: fregata — jedna bryła; klocek odsunięty od kadłuba — ostrzeżenie „kadłub w 2 kawałkach”
    await ev(`${k}.preset("klocki")`);
    await ev(`${k}.built()`);
    const rama = { przed: await ev(`document.getElementById('blk-stats').innerText.split('\\n').at(-1)`) };
    await ev(`${k}.edit((d) => { d.shapes.push({ kind: 'block', shape: 'rect', x: 0, y: -60, w: 8, h: 4, level: 1 }); })`);
    await ev(`${k}.built(); ${k}.blk.tool(); document.getElementById('blk-palette').scrollIntoView({ block: 'start' })`);
    await shot('klocki-rama-ostrzezenie', 'Panel klocków: ostrzeżenie o ramie w kawałkach (klocek odsunięty od burty)');
    rama.po = await ev(`document.getElementById('blk-stats').innerText.split('\\n').at(-1)`);
    report.rama_klocki = rama;
    console.log('klocki rama', JSON.stringify(rama));
  }
  report.bledy = logs.errors().filter((l) => !/favicon|DevTools|\[vite\]/.test(l)).slice(0, 20);
} catch (e) {
  report.blad = String(e?.stack || e);
  console.log('BŁĄD', report.blad);
} finally {
  await chrome.close();
  await server.close();
}
writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2) + '\n');
const sync = Object.values(report.zrzuty).reduce((m, z) => Math.max(m, z.syncPipes || 0), 0);
console.log('pipeline’y synchroniczne w klatkach (maks.):', sync, JSON.stringify(Object.values(report.zrzuty).at(-1)?.syncNames || []));
console.log('błędy strony:', (report.bledy || []).length, (report.bledy || []).slice(0, 5).join(' | '));
process.exit(report.blad ? 1 : 0);
