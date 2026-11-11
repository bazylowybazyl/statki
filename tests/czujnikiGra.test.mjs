// Czujniki w grze (2026-11-11, reguła kontakt-czujnikow): widok czujki na stronie (src/ui/czujkaView.js — port `step`
// dema), blok migawki `czujniki`, warstwa NAKŁADKI w Core3D (po mgle wojny w „uber”), wejście PPM / Alt + PPM, misja 1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SP = await import('../src/game/sensorPicture.js');
const D = await import('../src/game/sensorDetection.js');
const V = await import('../src/ui/czujkaView.js');
const L = await import('../src/3d/czujniki/czujnikiLayout.js');
const B = await import('../src/render/blocks/czujnikiBlock.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const I = L.CZUJNIKI_IN;
const G = L.GRANICA_REC;
const K = L.KONTAKT_REC;

function picture(player, npcs, stations = null) {
  const adapters = {
    alive: (e) => !!e && !e.dead, sideOf: (e) => e.side,
    posOf: (e, out) => { out.x = e.x; out.y = e.y; return out; },
    passiveOf: (e) => e.passive, activeOf: (e, p) => p, baseSigOf: (e) => e.sig, visionOf: (e) => e.vision,
    coverAt: () => 1, identified: (e) => Math.hypot(e.x - player.x, e.y - player.y) <= player.vision,
    cloaked: () => false, writeState: () => {}, isStation: (e) => !!e.isStation
  };
  const P = SP.createSensorPicture(adapters);
  const W = { player, npcs, stations, extraSources: null };
  const update = () => SP.updateSensorPicture(P, 0, W, true);
  update();
  return { P, update };
}

function run(view, inp, seconds, dt = 1 / 60) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    inp.time += dt;
    V.stepCzujkaView(view, dt, inp);
  }
  return V.packCzujkaView(view, V.createCzujnikiInput(), inp);
}

const baseInp = (P, extra = {}) => ({
  time: 0, on: false, aim: 0, px: 0, py: 0, shipLen: 1800, sig: 1, picture: P, poseOf: null, bodies: [], alpha: 1, show: true, ...extra
});

test('widok: PPM trzymany — czujka (struna w stronę myszki, ząb grupy w namiarze), puszczony — gaśnie', () => {
  const player = { x: 0, y: 0, side: 'friendly', passive: 80000, sig: 1.3, vision: 18000 };
  const baza = { x: 50000, y: 0, side: 'pirate', passive: 10000, sig: 1.5, vision: 9000, isStation: true };
  const statek = { x: 51000, y: 800, side: 'pirate', passive: 10000, sig: 0.7, vision: 5000 };
  const { P } = picture(player, [statek], [baza]);
  assert.equal(P.threats.n, 1, 'baza i statek — jedna grupa');
  assert.equal(P.threats.nSt[0], 1, 'stacja w grupie (duży ząb)');
  assert.equal(P.threats.meLvl[0], D.SENSOR_LEVEL.CONTACT);
  const view = V.createCzujkaView();
  const inp = baseInp(P);
  let out = run(view, inp, 0.5);
  assert.equal(out[I.strunaOn], 0, 'bez PPM — bez czujki');
  assert.equal(out[I.nStr], 0);
  // PPM w stronę bazy (oś +x)
  inp.on = true; inp.aim = 0;
  out = run(view, inp, 1.2);
  assert.equal(out[I.strunaOn], 1);
  assert.ok(out[I.vis] > 0.9, `widoczność ${out[I.vis]}`);
  assert.ok(Math.abs(out[I.phi]) < 0.02, 'struna w stronę myszki');
  assert.equal(out[I.nStr], 1, 'grupa w namiarze');
  const s = I.strBase;
  assert.equal(out[s + 1], 1, 'jedna budowla');
  assert.equal(out[s + 2], 1, 'jeden statek');
  assert.ok(out[s + 3] > 0.9, 'ząb wyłoniony');
  assert.ok(out[I.amp] > 1, 'sygnał technologiczny — struna drga');
  assert.ok(view.usedSec > 1, 'użycie czujki liczone (samouczek)');
  // myszka w przeciwną stronę — grupa wypada z namiaru
  inp.aim = Math.PI;
  out = run(view, inp, 2);
  assert.ok(out[I.nStr] === 0 || out[I.strBase + 3] < 0.05, 'poza namiarem ząb znika');
  // puszczony PPM — czujka gaśnie
  inp.on = false;
  out = run(view, inp, 3);
  assert.equal(out[I.strunaOn], 0);
});

test('widok: obustronnie — obserwator bez twarzy daje samą granicę (bez kontaktu i zęba), całego koła nie widać', () => {
  const player = { x: 0, y: 0, side: 'friendly', passive: 8000, sig: 0.5, vision: 5000 };
  const lowca = { x: 30000, y: 0, side: 'pirate', passive: 80000, sig: 0.5, vision: 18000 };
  const { P } = picture(player, [lowca]);
  assert.equal(P.watchers.n, 1);
  const view = V.createCzujkaView();
  const inp = baseInp(P, { on: true, aim: 0 });
  const out = run(view, inp, 1.5);
  assert.equal(out[I.nKon], 0, 'nie wykrywam go — bez obłoku X-ów');
  assert.equal(out[I.nStr], 0, 'ani zęba na strunie');
  assert.equal(out[I.nGrn], 1, 'ale jego granica jest');
  const o = I.grnBase;
  assert.ok(Math.abs(out[o + G.R] - 40000) < 1, 'promień = jego czujnik × mój ślad');
  assert.ok(out[o + G.grayA] > 0.95, 'szara (on ma mnie w kontakcie)');
  assert.ok(out[o + G.knownA] < 0.01, 'całego koła nie widać — nie wiem, gdzie jest');
  assert.equal(out[o + G.est], 1, 'jego wzrok nieznany — kreski');
});

test('widok: kontakt = obłok X-ów; identyfikacja zwija go (objawienie), utrata wzroku — wraca', () => {
  const player = { x: 0, y: 0, side: 'friendly', passive: 42000, sig: 0.5, vision: 7000 };
  const patrol = { x: 15000, y: 0, side: 'pirate', passive: 18000, sig: 0.7, vision: 5000 };
  const { P, update } = picture(player, [patrol]);
  const view = V.createCzujkaView();
  const inp = baseInp(P);
  let out = run(view, inp, 1.5);
  assert.equal(out[I.nKon], 1, 'kontakt — obłok X-ów');
  const k = I.konBase;
  assert.ok(out[k + K.alpha] > 0.95, 'narósł');
  assert.equal(out[k + K.cls], D.contactSizeClass(0.7));
  assert.equal(out[k + K.Rk], 1);
  // granica patrolu: szara widoczna (wykrywam ich), całe koło szarej tak, czerwonej nie
  const o = I.grnBase;
  assert.equal(out[I.nGrn], 1);
  assert.ok(out[o + G.knownA] > 0.95 && out[o + G.knownV] < 0.05);
  // podlatuję: identyfikacja — obłok się zwija i gaśnie
  patrol.x = 6000;
  update();
  out = run(view, inp, 0.3);
  assert.ok(out[I.nKon] === 1 && out[k + K.Rk] < 1, 'w trakcie objawienia obłok maleje');
  out = run(view, inp, 1);
  assert.equal(out[I.nKon], 0, 'kadłub odsłonięty — obłoku nie ma');
  assert.ok(out[o + G.knownV] > 0.9, 'czerwona (ich wzrok) — całe koło, bo ich widzę');
  // odlatuje poza mój wzrok — obłok wraca
  patrol.x = 15000;
  update();
  out = run(view, inp, 1);
  assert.equal(out[I.nKon], 1);
  assert.ok(out[k + K.alpha] > 0.5);
});

test('widok: przejście granicy (oni łapią mnie) — zdarzenie przy kole kontaktu; zniknięcie grupy — bez zdarzenia', () => {
  const player = { x: 0, y: 0, side: 'friendly', passive: 80000, sig: 1.3, vision: 18000 };
  const wrog = { x: 40000, y: 0, side: 'pirate', passive: 20000, sig: 1.0, vision: 9000 };
  const { P, update } = picture(player, [wrog]);
  const view = V.createCzujkaView();
  const inp = baseInp(P);
  let out = run(view, inp, 0.5);
  assert.equal(out[I.grnBase + G.ageC], -1, 'bez przejścia');
  wrog.x = 22000;   // 20 km × 1,3 = 26 km — ma mnie
  update();
  out = run(view, inp, 0.2);
  const o = I.grnBase;
  assert.ok(out[o + G.ageC] >= 0 && out[o + G.ageC] < 0.3, 'świeże przejście kontaktu');
  assert.equal(out[o + G.dirC], 1, 'do środka');
  // zniszczony — granica gaśnie bez „wyjścia”
  wrog.dead = true;
  update();
  out = run(view, inp, 3.5);
  assert.equal(out[I.nGrn], 0);
  assert.equal(view.groups.size, 0, 'grupa wypadła');
});

test('widok: błona — ciała układu (bliższe pierwsze do limitu), rodzaj z typu planety', () => {
  assert.equal(V.czujkaBodyKind('gas'), 1);
  assert.equal(V.czujkaBodyKind('terran'), 2);
  assert.equal(V.czujkaBodyKind('rocky'), 0);
  assert.equal(V.czujkaBodyKind('star'), 3);
  const bodies = [];
  for (let i = 0; i < 20; i++) bodies.push({ id: `p${i}`, x: 20000 * (i + 1), y: 0, R: 3000, kind: i % 3 });
  const view = V.createCzujkaView();
  const inp = baseInp(null, { on: true, bodies });
  const out = run(view, inp, 1);
  assert.equal(out[I.nBln], L.CZUJNIKI_MAX.blona);
  assert.ok(out[I.blnBase + 1] >= out[I.blnBase + I.blnStride + 1], 'najbliższe (największe c) pierwsze');
  assert.ok(out[I.blnBase + 3] > 0.5, 'echo impulsu wyłoniło ciało');
});

test('widok: bez pokazu (CIC, panel, kamera 3D) i w skoku (alfa soczewki) — nic do narysowania', () => {
  const player = { x: 0, y: 0, side: 'friendly', passive: 42000, sig: 0.5, vision: 7000 };
  const patrol = { x: 15000, y: 0, side: 'pirate', passive: 18000, sig: 0.7, vision: 5000 };
  const { P } = picture(player, [patrol]);
  const view = V.createCzujkaView();
  const inp = baseInp(P, { on: true });
  let out = run(view, inp, 1);
  assert.equal(out[I.active], 1);
  inp.alpha = 0;
  out = run(view, inp, 0.1);
  assert.equal(out[I.nKon], 0);
  assert.equal(out[I.granicaOn], 0);
  inp.alpha = 1; inp.show = false;
  out = run(view, inp, 4);
  assert.equal(out[I.active], 0);
});

test('grupy zagrożeń: budowle (adapter isBuilding) to duże zęby struny', () => {
  const player = { x: 0, y: 0, side: 'friendly', passive: 80000, sig: 1.3, vision: 18000 };
  const habitat = { x: 50000, y: 0, side: 'pirate', passive: 60000, sig: 1, vision: 9000, baseStructure: true };
  const okret = { x: 50500, y: 0, side: 'pirate', passive: 18000, sig: 0.7, vision: 5000 };
  const adapters = {
    alive: (e) => !!e && !e.dead, sideOf: (e) => e.side,
    posOf: (e, out) => { out.x = e.x; out.y = e.y; return out; },
    passiveOf: (e) => e.passive, activeOf: (e, p) => p, baseSigOf: (e) => e.sig, visionOf: (e) => e.vision,
    coverAt: () => 1, identified: () => false, cloaked: () => false, writeState: () => {},
    isStation: () => false, isBuilding: (e) => !!e.baseStructure
  };
  const P = SP.createSensorPicture(adapters);
  SP.updateSensorPicture(P, 0, { player, npcs: [habitat, okret], stations: null, extraSources: null }, true);
  assert.equal(P.threats.n, 1);
  assert.equal(P.threats.count[0], 2);
  assert.equal(P.threats.nSt[0], 1, 'habitat bazy — budowla');
});

test('blok migawki `czujniki`: kopia nagłówka i zajętych sekcji; brak wejścia — pusty', () => {
  const src = V.createCzujnikiInput();
  src[I.active] = 1; src[I.nStr] = 2; src[I.nKon] = 3; src[I.nGrn] = 1; src[I.nBln] = 1;
  for (let i = I.header; i < I.size; i++) src[i] = i;
  const dst = new Float64Array(I.size).fill(-7);
  B.packCzujnikiBlock(dst, src);
  for (let i = 0; i < I.header; i++) assert.equal(dst[i], src[i]);
  assert.equal(dst[I.strBase + 2 * I.strStride - 1], src[I.strBase + 2 * I.strStride - 1]);
  assert.equal(dst[I.strBase + 2 * I.strStride], -7, 'poza licznikiem — bez kopii');
  assert.equal(dst[I.konBase + 3 * I.konStride - 1], src[I.konBase + 3 * I.konStride - 1]);
  B.packCzujnikiBlock(dst, null);
  assert.equal(dst[I.active], 0);
  const blk = B.createCzujnikiBlock();
  assert.equal(blk.name, 'czujniki');
  assert.equal(blk.f64, I.size);
  assert.equal(blk.phase, 'finish');
});

test('wpięcie: nakładka po mgle wojny w „uber”, worker z bloku, strona w render(), PPM / Alt + PPM, misja 1 bez przelotu kamery', () => {
  const post = read('src/3d/tsl/postGry.js');
  const body = post.slice(post.indexOf('export function createUberPost'));
  const fogAt = body.indexOf('applyFogOfWar(fog, sceneColor');
  const ovAt = body.indexOf('If(uOverlayLayerOn.greaterThan(0.5)');
  const cloakAt = body.indexOf('applyCloakView(uCloakView');
  assert.ok(fogAt > 0 && ovAt > fogAt && cloakAt > ovAt, 'nakładka po mgle wojny, przed wizjerem maskowania i ACES');
  const cz = read('src/3d/czujniki/czujniki3D.js');
  assert.match(cz, /m\.layers\.set\(FX_OVERLAY_LAYER\)/);
  assert.match(cz, /Core3D\.setOverlayLayerActive\(true\)/);
  assert.match(cz, /Core3D\.warmup\.add\(\{ name: 'czujniki: nakładka', objects: \(\) => Czujniki\.warmupOverlay\(\), layer: FX_OVERLAY_LAYER, phase: 'loading' \}\)/);
  assert.match(cz, /Core3D\.warmup\.add\(\{ name: 'czujniki: refrakcja \(DIST\)', objects: \(\) => Czujniki\.warmupDist\(\), layer: FX_DISTORT_LAYER, phase: 'loading' \}\)/);
  const wk = read('src/render/render.worker.js');
  assert.match(wk, /st\.czujniki\.submit\(st\.czujnikiBlk\.czujnikiInputOf\(v\)\)/);
  const html = read('index.html');
  assert.match(html, /renderSnapshot\.addBlock\(createCzujnikiBlock\(\)\);/);
  assert.match(html, /f\.czujniki = czujnikiIn;/);
  assert.match(html, /stepCzujniki\(cam, frameDt, window\.__interpShipPose\);/);
  assert.match(html, /if \(!RW_WORKER\) Czujniki\.submit\(czujnikiIn\);/);
  // PPM: Alt — menu rozkazów, sam — czujka; puszczenie (także poza kanwą) gasi
  assert.match(html, /if \(e\.altKey\) \{\n\s+czujkaInput\.held = false;\n\s+openNormalWorldCommandMenuAt\(e\.clientX, e\.clientY\);/);
  assert.match(html, /closeWorldCommandMenu\(\);\n\s+czujkaInput\.held = true;/);
  assert.match(html, /window\.addEventListener\('mouseup', \(e\) => \{ if \(e\.button === 2\) czujkaInput\.held = false; \}\);/);
  // misja 1: po przylocie kamera nigdzie nie leci, bez znacznika miejsca masy
  const m1 = read('src/game/story/missions/mission01.js');
  const scout = m1.slice(m1.indexOf("ctx.phase('scout')"), m1.indexOf("ctx.phase('approach')"));
  assert.doesNotMatch(scout, /cinema\.lookAt/);
  assert.doesNotMatch(scout, /ui\.marker\('mass'/);
  assert.match(scout, /hint\('czujka'/);
  // zasilanie: obraz czujników liczy wyłączone okręty (czujniki bierne, ślad × 0,3); okręty w doku misji 1 wyłączone,
  // rozruch NPC fabuły nie odpala silników (zapłon z dymem przed wylotem), budzenie / start / działa — od razu w PRACY
  assert.match(html, /passiveOf\(e\) \{ return resolveAwarenessSensorRange\(e\) \* powerSensorMul\(e\); \}/);
  assert.match(html, /baseSigOf\(e\) \{ return getEntitySizeModifier\(e\) \* powerSignatureMul\(e\)/);
  assert.match(html, /isBuilding\(e\) \{ return !!\(e\.isStation \|\| e\.baseStructure\); \}/);
  assert.match(html, /!e\.__powerManualIgnite && !enginesBefore/);
  assert.match(html, /function storyWakeNpc\(npc\) \{\n\s+if \(!npc \|\| npc\.dead\) return;\n\s+storyPowerOnNow\(npc\);/);
  assert.match(html, /launchNpc: \(e, path, delay, opts\) => \{ storyPowerOnNow\(e\);/);
  assert.match(html, /armNpc: \(e\) => \{ storyPowerOnNow\(e\);/);
  const sg = read('src/game/story/storyGame.js');
  assert.match(sg, /this\.deps\.sleepNpc\(e\);[\s\S]{0,400}this\.deps\.powerNpc\?\.\(e, false\);/);
  // moduły bez window / DOM / Math.random
  for (const f of ['src/ui/czujkaView.js', 'src/3d/czujniki/czujniki3D.js', 'src/3d/czujniki/czujnikiLayout.js', 'src/render/blocks/czujnikiBlock.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /\bwindow\./, `${f}: bez window`);
    assert.doesNotMatch(src, /\bdocument\./, `${f}: bez DOM`);
    assert.doesNotMatch(src, /Math\.random/, `${f}: bez Math.random`);
  }
});
