// Zasięg radarów (prototyp ?radarZasiegi, 2026-11-04): obraz czujników z gry (src/game/sensorPicture.js) — wiedza strony
// gracza o radarach wroga, strefy dla UI, ciepło ostrzału, duchy; fale (scaleCoverageInto) i wpięcie w grę (strażnicy źródeł).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SP = await import('../src/game/sensorPicture.js');
const D = await import('../src/game/sensorDetection.js');
const C = await import('../src/game/sensorCoverage.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

function world() {
  const player = { name: 'atlas', x: 0, y: 0, side: 'friendly', passive: 80000, sig: 1.3, vision: 18000 };
  const escort = { name: 'eskorta', x: -2000, y: 0, side: 'friendly', passive: 18000, sig: 0.7, vision: 5000 };
  const czata = { name: 'czata', x: 15000, y: 0, side: 'pirate', passive: 18000, sig: 0.7, vision: 5000 };
  const flota = { name: 'flota', x: 60000, y: 0, side: 'pirate', passive: 45000, sig: 1.0, vision: 11000 };
  const kupiec = { name: 'kupiec', x: 5000, y: 5000, side: null, passive: 10000, sig: 1, vision: 5000 };
  const adapters = {
    alive: (e) => !!e && !e.dead,
    sideOf: (e) => e.side,
    posOf: (e, out) => { out.x = e.x; out.y = e.y; return out; },
    passiveOf: (e) => e.passive,
    activeOf: (e, p) => p * 1.2,
    baseSigOf: (e) => e.sig,
    visionOf: (e) => e.vision,
    coverAt: (x) => (x > 100000 ? 0.6 : 1),
    // mgła wojny gracza: wzrok Atlasa 18 km
    identified: (e) => Math.hypot(e.x - player.x, e.y - player.y) <= player.vision,
    cloaked: () => false,
    writeState: () => {}
  };
  const P = SP.createSensorPicture(adapters);
  const W = { player, npcs: [escort, czata, flota, kupiec], stations: null, extraSources: () => [{ x: 0, y: 30000, range: 30000, type: 'drone' }] };
  return { P, W, player, escort, czata, flota, kupiec };
}

test('wiedza: czata w wzroku zidentyfikowana (prawdziwa moc), flota poza wzrokiem — KONTAKT z mocą zgadniętą', () => {
  const { P, W, czata, flota } = world();
  SP.updateSensorPicture(P, 0, W, true);
  assert.ok(P.ready);
  const kc = P.know.get(czata), kf = P.know.get(flota);
  assert.equal(kc.level, D.SENSOR_LEVEL.IDENTIFIED);
  assert.equal(kc.ident, true);
  assert.equal(kf.level, D.SENSOR_LEVEL.CONTACT, 'Atlas 80 km × 1,0 sięga floty 60 km');
  assert.equal(kf.ident, false);
  assert.ok(kf.err > 0, 'kontakt ma niepewne miejsce');
  assert.ok(Math.hypot(kf.x - flota.x, kf.y - flota.y) <= kf.err + 1e-6);
  assert.equal(P.knowList.length, 2, 'neutralny kupiec poza obrazem stron');
  // strefy: czata — 18 km × sygnatura Atlasa 1,3; flota — moc zgadnięta z rozmiaru (1,0 → DUŻY → 45 km)
  assert.equal(P.enemy.n, 2);
  const radii = [...P.enemy.r.subarray(0, 2)].sort((a, b) => a - b);
  assert.ok(near(radii[0], 18000 * 1.3));
  assert.ok(near(radii[1], P.tune.strengthGuess[D.contactSizeClass(1.0)] * 1.3));
  const infoF = P.enemyInfo.find((i) => i.k === kf);
  assert.equal(infoF.est, true);
  // gracz: 15 km od czaty (jej strefa 23,4 km) — w znanej strefie; prawda też (czata widzi Atlasa)
  assert.equal(P.player.detectedKnown, 1);
  assert.equal(P.player.detectedTrue, 1);
  assert.ok(P.player.edge.inside);
  assert.ok(near(P.player.edge.dist, 18000 * 1.3 - 15000, 1e-3));
  // własne czujniki: Atlas, eskorta (cel pancernika) i dron (zasięg własny)
  assert.equal(P.own.n, 3);
});

test('przebudowa co refreshSec czasu logiki; ciepło ostrzału podnosi sygnaturę gracza i gaśnie', () => {
  const { P, W, player } = world();
  SP.updateSensorPicture(P, 0, W, true);
  const v0 = P.version;
  SP.noteSensorPictureFire(P, player);              // strzał w chwili 0
  assert.equal(SP.updateSensorPicture(P, 0.1, W), false);
  assert.equal(P.version, v0);
  assert.equal(SP.updateSensorPicture(P, 0.15, W), true);
  assert.equal(P.version, v0 + 1);
  const T = D.DETECTION_TUNE.signature;
  const heat = 1 - 0.25 / T.fireSec;
  assert.ok(near(P.player.signature, 1.3 * (1 + T.fireAdd * heat), 1e-9), `sygnatura ${P.player.signature}`);
  for (let i = 0; i < 40; i++) SP.updateSensorPicture(P, 0.25, W);
  assert.ok(near(P.player.signature, 1.3), 'po 10 s ciepło zgasło');
});

test('cicha praca gracza (stan) zmniejsza strefy wroga; osłona przy graczu też', () => {
  const { P, W, player } = world();
  const st = SP.sensorStateOf(P, player);
  st.silent = true;
  SP.updateSensorPicture(P, 0, W, true);
  const T = D.DETECTION_TUNE;
  assert.ok(near(P.player.sigEff, 1.3 * T.signature.silentMul));
  assert.equal(P.player.detectedKnown, 0, 'czata 15 km, strefa w ciszy 11,7 km');
  st.silent = false;
  player.x = 101000;
  SP.updateSensorPicture(P, 0, W, true);
  assert.ok(near(P.player.cover, 0.6));
  assert.ok(near(P.player.sigEff, 1.3 * 0.6));
});

test('duch: zgubiony kontakt zostaje ghostSec w ostatnim miejscu, potem strefa znika; martwy — od razu', () => {
  const { P, W, flota, czata } = world();
  SP.updateSensorPicture(P, 0, W, true);
  flota.x = 200000;   // poza zasięgiem Atlasa
  SP.updateSensorPicture(P, 0.2, W);
  const kf = P.know.get(flota);
  assert.equal(kf.level, 0);
  assert.equal(SP.sensorKnowState(P, kf), 'ghost');
  assert.ok(kf.x < 100000, 'duch w ostatnim znanym miejscu');
  assert.equal(P.enemy.n, 2, 'strefa ducha zostaje');
  for (let i = 0; i < 130; i++) SP.updateSensorPicture(P, 0.2, W);
  assert.equal(SP.sensorKnowState(P, kf), null, 'duch wygasł (wpis zostaje, póki byt żyje w grze)');
  assert.equal(P.enemy.n, 1);
  const kc = P.know.get(czata);
  czata.dead = true;
  SP.updateSensorPicture(P, 0.2, W, true);
  assert.equal(P.knowList.includes(kc), false, 'martwy byt wypada z wiedzy od razu');
  assert.equal(P.enemy.n, 0);
  assert.equal(P.player.detectedKnown, 0);
});

test('kurs śledzonego bytu ukrytego mgłą — z ostatniej identyfikacji, nie bieżący', () => {
  const { P, W, czata } = world();
  czata.angle = 1;
  SP.updateSensorPicture(P, 0, W, true);
  const k = P.know.get(czata);
  assert.equal(k.ang, 1);
  czata.x = 40000; czata.angle = 2;     // poza wzrokiem, w zasięgu czujników — śledzony
  SP.updateSensorPicture(P, 0.2, W);
  assert.equal(k.level, D.SENSOR_LEVEL.CONTACT);
  assert.equal(k.ident, true);
  assert.equal(k.ang, 1);
});

test('odkryta stacja, która przestała być wrogiem, wypada z wiedzy (bez wiecznej strefy)', () => {
  const { P, W } = world();
  const st = { name: 'stacja', x: 10000, y: 0, side: 'pirate', isStation: true, passive: 0, sig: 1.5, vision: 30000 };
  W.stations = [st];
  SP.updateSensorPicture(P, 0, W, true);
  const k = P.know.get(st);
  assert.equal(k.disc, true);
  assert.ok(P.player.detectedKnown >= 1);
  st.side = null;                         // reputacja: już nie wróg
  SP.updateSensorPicture(P, 0.2, W);
  assert.equal(P.knowList.includes(k), false);
  assert.ok(!P.enemyInfo.slice(0, P.enemy.n).some((i) => i.k === k));
});

test('ponowny kontakt po zgubieniu — znów bez identyfikacji (aż do wzroku)', () => {
  const { P, W, czata, player } = world();
  SP.updateSensorPicture(P, 0, W, true);
  assert.equal(P.know.get(czata).ident, true);
  czata.x = 300000;
  for (let i = 0; i < 10; i++) SP.updateSensorPicture(P, 0.2, W);
  czata.x = 40000; // w zasięgu czujników, poza wzrokiem
  SP.updateSensorPicture(P, 0.2, W);
  const k = P.know.get(czata);
  assert.equal(k.level, D.SENSOR_LEVEL.CONTACT);
  assert.equal(k.ident, false);
  assert.equal(player.x, 0);
});

test('grupy zagrożeń: wrogowie w jednym miejscu to jedna grupa, ich i mój zasięg jako ułamek odległości', () => {
  const { P, W, czata, flota } = world();
  const obok = { name: 'obok', x: 15000, y: 4000, side: 'pirate', passive: 10000, sig: 0.7, vision: 5000 };
  const polnoc = { name: 'polnoc', x: 0, y: -30000, side: 'pirate', passive: 30000, sig: 0.85, vision: 8000 };
  W.npcs.push(obok, polnoc);
  SP.updateSensorPicture(P, 0, W, true);
  const F = P.threats;
  assert.equal(F.n, 3, 'czata z sąsiadem, flota 45 km dalej (ten sam kierunek — osobna grupa), północ');
  const of = (e) => { for (let g = 0; g < F.n; g++) if (F.lead[g].e === e) return g; return -1; };
  const gc = of(czata), gf = of(flota), gn = of(polnoc);
  assert.ok(gc >= 0 && gf >= 0 && gn >= 0, 'liderem grupy jest najgroźniejszy');
  assert.equal(F.count[gc], 2);
  // ich zasięg względem mnie: czata 18 km × sygnatura Atlasa 1,3 przy 15 km odległości
  assert.ok(near(F.themR[gc], 18000 * 1.3));
  assert.ok(near(F.them[gc], 18000 * 1.3 / 15000));
  assert.ok(near(F.dist[gc], 15000));
  assert.ok(near(F.ang[gc], 0));
  assert.equal(F.x[gc], czata.x, 'znak wroga wychodzi z miejsca lidera');
  // mój zasięg względem nich: czujniki Atlasa 80 km × sygnatura czaty 0,7
  assert.ok(near(F.meR[gc], 80000 * 0.7));
  // północ: poza wzrokiem — KONTAKT, moc zgadnięta (sygnatura 0,85 → ŚREDNI)
  assert.equal(F.est[gn], 1);
  assert.ok(near(F.themR[gn], P.tune.strengthGuess[D.contactSizeClass(0.85)] * 1.3));
  assert.ok(Math.abs(F.ang[gn] + Math.PI / 2) < 0.08, 'kierunek z miejsca przybliżonego kontaktu');
  // cisza: mój ślad sygnałowy krótszy — ich zasięg względem mnie krótszy
  SP.sensorStateOf(P, W.player).silent = true;
  SP.updateSensorPicture(P, 0, W, true);
  assert.ok(near(P.threats.themR[gc], 18000 * 1.3 * D.DETECTION_TUNE.signature.silentMul));
});

test('grupy zagrożeń: więcej wrogów niż pojemność buforów, liczności się sumują, po zniknięciu wrogów pusto', () => {
  const { P, W } = world();
  W.npcs = [];
  for (let i = 0; i < 150; i++) W.npcs.push({ x: Math.cos(i * 0.7) * 35000, y: Math.sin(i * 0.7) * 35000, side: 'pirate', passive: 18000, sig: 0.7, vision: 5000 });
  SP.updateSensorPicture(P, 0, W, true);
  const F = P.threats;
  assert.ok(F.n > 1);
  let sum = 0;
  for (let g = 0; g < F.n; g++) sum += F.count[g];
  assert.equal(sum, P.knowList.filter((k) => SP.sensorKnowState(P, k) === 'live').length);
  W.npcs = [];
  SP.updateSensorPicture(P, 0, W, true);
  assert.equal(P.threats.n, 0);
  assert.equal(P.threats.lead[0], null, 'bez trzymania wpisów bytów, których już nie ma');
});

// Rejestrator kanwy: środki łuków, ścieżki (moveTo / lineTo), wypełnienia, napisy.
function recorder() {
  const rec = { arcs: [], paths: [], fills: 0, texts: [] };
  let cur = null;
  const ctx = new Proxy({}, {
    get: (t, k) => {
      if (k === 'arc') return (x, y) => { rec.arcs.push([x, y]); };
      if (k === 'beginPath') return () => { cur = []; rec.paths.push(cur); };
      if (k === 'moveTo' || k === 'lineTo') return (x, y) => { cur?.push([x, y, k]); };
      if (k === 'fill') return () => { rec.fills++; };
      if (k === 'fillText') return (s) => { rec.texts.push(s); };
      if (k in t) return t[k];
      return () => {};
    },
    set: (t, k, v) => { t[k] = v; return true; }
  });
  return { ctx, rec };
}
const lookView = (zoom = 0.01) => ({
  W: 1600, H: 900, zoom, bottomInset: 0,
  project(x, y, o) { o.x = 800 + x * this.zoom; o.y = 450 + y * this.zoom; return o; },
  poseOf(e, o) { o.x = e.x; o.y = e.y; o.angle = 0; return true; },
  hullHalf(e, o) { o.hx = o.hy = 10; return o; }
});
const drawLook = async (look, P, view, state, time = 1) => {
  const O = await import('../src/ui/radarRangeOverlay.js');
  O.setRadarLook(look);
  const { ctx, rec } = recorder();
  O.drawThreatLook(ctx, P, view, 800, 450, 30, 1, O.RADAR_RANGE_STYLE, state, time, true);
  O.setRadarLook('wachlarz');
  return { rec, S: O.RADAR_RANGE_STYLE };
};
const soloEnemy = (passive = 18000, x = 15000) => {
  const w = world();
  w.W.npcs = [{ name: 'wrog', x, y: 0, side: 'pirate', passive, sig: 0.7, vision: 5000 }];
  w.W.extraSources = null;
  SP.updateSensorPicture(w.P, 0, w.W, true);
  return w;
};

test('wachlarz: JEDEN na okręt — przy mnie i przy wrogu, żadnych dwóch przy jednym; grot, gdy sięga', async () => {
  const O = await import('../src/ui/radarRangeOverlay.js');
  const { P } = soloEnemy();
  const { rec, S } = await drawLook('wachlarz', P, lookView(), O.createThreatLookState());
  const at = (x, y) => rec.arcs.filter((a) => Math.abs(a[0] - x) < 1e-6 && Math.abs(a[1] - y) < 1e-6).length;
  assert.equal(at(800, 450), S.fanArcs, 'przy mnie jeden wachlarz');
  assert.equal(at(950, 450), S.fanArcs, 'przy wrogu jeden wachlarz');
  assert.equal(rec.arcs.length, 2 * S.fanArcs, 'żadnych innych łuków');
  // oni sięgają (1,56) i ja sięgam (3,7) — dwa groty; podpisy ONI / odległość / TY
  assert.equal(rec.fills, 2);
  assert.equal(rec.texts.length, 3);
  // wróg daleko: jego wachlarz bez grota (nie sięga), mój z grotem
  const far = soloEnemy(18000, 40000);
  const r2 = await drawLook('wachlarz', far.P, lookView(), O.createThreatLookState());
  assert.equal(r2.rec.fills, 1);
});

test('wachlarz: wróg poza kadrem — znak wroga przy krawędzi, na prostej ku graczowi', async () => {
  const O = await import('../src/ui/radarRangeOverlay.js');
  const { P } = soloEnemy();
  const { rec, S } = await drawLook('wachlarz', P, lookView(0.1), O.createThreatLookState());
  const edge = 1600 - S.fanEdgeInset;
  assert.equal(rec.arcs.filter((a) => Math.abs(a[0] - edge) < 1e-6 && Math.abs(a[1] - 450) < 1e-6).length, S.fanArcs);
});

test('struna: drga tym mocniej, im bliżej wykrycia; po sięgnięciu pęka na dwa końce', async () => {
  const O = await import('../src/ui/radarRangeOverlay.js');
  const S = O.RADAR_RANGE_STYLE;
  // kadr 0,1: wróg poza kadrem — ścieżki przy mnie nie mieszają się ze struną przy wrogu
  const dev = async (them) => {
    const { P } = soloEnemy(them * 15000 / 1.3);
    const st = O.createThreatLookState();
    const r = 30 + S.strunaGap;
    let max = 0;
    for (let t = 0; t < 1.5; t += 0.037) {
      const { rec } = await drawLook('struna', P, lookView(0.1), st, t);
      for (const path of rec.paths) {
        if (!path.length || Math.hypot(path[0][0] - 800, path[0][1] - 450) > 200) continue;
        for (const [x, y] of path) max = Math.max(max, Math.abs(Math.hypot(x - 800, y - 450) - r));
      }
    }
    return max;
  };
  const calm = await dev(0.3), mid = await dev(0.7), close = await dev(0.97);
  assert.ok(calm < 1, `daleko prawie prosta (${calm})`);
  assert.ok(mid > calm * 3, `w połowie drga (${mid})`);
  assert.ok(close > mid * 1.5 && close > S.strunaAmp * 0.6, `tuż przed progiem drga mocno (${close} > ${mid})`);
  // cała: jedna ścieżka przy mnie; sięgnięta: dwa końce
  const pathsAtMe = async (them) => {
    const { P } = soloEnemy(them * 15000 / 1.3);
    const { rec } = await drawLook('struna', P, lookView(0.1), O.createThreatLookState());
    return rec.paths.filter((p) => p.length > 5 && Math.hypot(p[0][0] - 800, p[0][1] - 450) < 200).length;
  };
  assert.equal(await pathsAtMe(0.9), 1);
  assert.equal(await pathsAtMe(1.2), 2);
});

test('struna: grupy w jednym kierunku nie nakładają strun przy mnie — zostaje struna najgroźniejszej', async () => {
  const O = await import('../src/ui/radarRangeOverlay.js');
  const w = world();
  // dwie grupy > 15 km od siebie, kierunek prawie ten sam; trzecia z tyłu
  w.W.npcs = [
    { x: 15000, y: 0, side: 'pirate', passive: 9000, sig: 0.7, vision: 5000 },
    { x: 40000, y: 2000, side: 'pirate', passive: 18000, sig: 0.7, vision: 5000 },
    { x: -17000, y: 0, side: 'pirate', passive: 9000, sig: 0.7, vision: 5000 }
  ];
  w.W.extraSources = null;
  SP.updateSensorPicture(w.P, 0, w.W, true);
  assert.equal(w.P.threats.n, 3);
  const { rec } = await drawLook('struna', w.P, lookView(0.1), O.createThreatLookState());
  const r = 30 + O.RADAR_RANGE_STYLE.strunaGap;
  const near = rec.paths.filter((p) => p.length > 5 && Math.abs(Math.hypot(p[0][0] - 800, p[0][1] - 450) - r) < 40);
  assert.equal(near.length, 2, 'jedna struna na wschód, jedna na zachód');
});

test('błona: jeden kształt, wybrzuszenie ku wrogowi rośnie z ich zasięgiem, promień bazowy ze śladu, sięgnięcie ją rozrywa', async () => {
  const O = await import('../src/ui/radarRangeOverlay.js');
  const S = O.RADAR_RANGE_STYLE;
  const shape = async (them, silent = false) => {
    const w = soloEnemy(them * 15000 / 1.3);
    if (silent) { SP.sensorStateOf(w.P, w.W.player).silent = true; SP.updateSensorPicture(w.P, 0, w.W, true); }
    const { rec } = await drawLook('blona', w.P, lookView(0.1), O.createThreatLookState());
    const fill = rec.paths[0];
    const rad = (i) => Math.hypot(fill[i][0] - 800, fill[i][1] - 450);
    const stroked = rec.paths.slice(1).reduce((n, p) => n + Math.max(0, p.length - 1), 0);
    return { n: fill.length, front: rad(0), back: rad(Math.round(S.blonaSeg / 2)), stroked };
  };
  const weak = await shape(0.5), strong = await shape(0.95);
  assert.equal(strong.n, S.blonaSeg + 1, 'jedna zamknięta ścieżka');
  assert.ok(strong.front > weak.front + 20, `ku wrogowi rośnie (${weak.front} → ${strong.front})`);
  assert.ok(Math.abs(strong.back - weak.back) < 12, 'na przeciwnej stronie bez wybrzuszenia');
  const quiet = await shape(0.5, true);
  assert.ok(quiet.back < weak.back - 5, `cisza kurczy błonę (${weak.back} → ${quiet.back})`);
  assert.equal(strong.stroked, S.blonaSeg, 'obrys cały');
  const torn = await shape(1.3);
  assert.ok(torn.stroked < S.blonaSeg, 'sięgnięcie rozrywa obrys');
});

test('grupy zagrożeń: lider z histerezą — chwiejna odległość nie przerzuca znaku wroga, wyraźna przewaga tak; them grupy to największe', () => {
  const { P, W } = world();
  const a = { name: 'a', x: 30000, y: 0, side: 'pirate', passive: 18000, sig: 0.7, vision: 5000 };
  const b = { name: 'b', x: 30000, y: 3000, side: 'pirate', passive: 18000, sig: 0.7, vision: 5000 };
  W.npcs = [a, b];
  W.extraSources = null;
  // obaj zidentyfikowani (stała moc), odległość bez niepewności kontaktu
  P.A.identified = () => true;
  SP.updateSensorPicture(P, 0, W, true);
  assert.equal(P.threats.n, 1);
  assert.equal(P.threats.lead[0].e, a, 'bliższy prowadzi');
  // b minimalnie bliżej — lider zostaje, ale them grupy to już większe (b)
  b.x = 28800; b.y = 0;
  SP.updateSensorPicture(P, 0, W, true);
  assert.equal(P.threats.lead[0].e, a, 'histereza: 4% bliżej to za mało');
  assert.ok(near(P.threats.them[0], 18000 * 1.3 / 28800), 'wartość progu nie zależy od premii lidera');
  // wyraźnie bliżej — zmiana lidera
  b.x = 20000;
  SP.updateSensorPicture(P, 0, W, true);
  assert.equal(P.threats.lead[0].e, b);
});

test('grupy zagrożeń: stojąca flota kontaktów nie rozpada się od wędrujących miejsc, a znak nie przeskakuje', () => {
  for (const spacing of [8000, 14000, 15000, 16000]) {
    const { P, W } = world();
    W.player.passive = 120000;
    W.extraSources = null;
    W.npcs = [
      { name: 'a', x: 60000, y: 0, side: 'pirate', passive: 18000, sig: 1, vision: 5000 },
      { name: 'b', x: 60000, y: spacing, side: 'pirate', passive: 18000, sig: 1, vision: 5000 },
      { name: 'c', x: 60000, y: -spacing, side: 'pirate', passive: 18000, sig: 1, vision: 5000 }
    ];
    let changes = 0, leads = 0, lastN = -1, lastLead = null;
    for (let i = 0; i < 600; i++) {
      SP.updateSensorPicture(P, 0.2, W, true);
      const F = P.threats;
      if (lastN >= 0 && F.n !== lastN) changes++;
      lastN = F.n;
      if (lastLead && F.lead[0] !== lastLead) leads++;
      lastLead = F.lead[0];
    }
    assert.ok(changes <= 2, `rozstaw ${spacing}: ${changes} zmian liczby grup na 120 s`);
    assert.ok(leads <= 6, `rozstaw ${spacing}: ${leads} zmian lidera na 120 s`);
  }
});

test('grupy zagrożeń: lider bez największego them — podpis odległości od tego z największym them', () => {
  const { P, W } = world();
  P.A.identified = () => true;
  W.extraSources = null;
  const a = { name: 'a', x: 24000, y: 0, side: 'pirate', passive: 18000, sig: 0.7, vision: 5000 };
  const b = { name: 'b', x: 26000, y: 0, side: 'pirate', passive: 18000, sig: 0.7, vision: 5000 };
  W.npcs = [a, b];
  SP.updateSensorPicture(P, 0, W, true);
  assert.equal(P.threats.lead[0].e, a);
  b.x = 23000;
  SP.updateSensorPicture(P, 0, W, true);
  const F = P.threats;
  assert.equal(F.lead[0].e, a, 'histereza trzyma lidera');
  assert.ok(near(F.them[0], 18000 * 1.3 / 23000));
  assert.ok(near(F.themD[0], 23000), 'odległość do członka, który sięga');
  assert.ok(near(F.dist[0], 24000), 'znak stoi przy liderze');
});

test('wachlarz: okręty zbyt blisko na ekranie — bez łuków wroga za graczem', async () => {
  const O = await import('../src/ui/radarRangeOverlay.js');
  const S = O.RADAR_RANGE_STYLE;
  const { P } = soloEnemy();
  // zoom mapy: 15 km = 6 px
  const { rec } = await drawLook('wachlarz', P, lookView(0.0004), O.createThreatLookState());
  assert.equal(rec.arcs.length, S.fanArcs, 'tylko mój wachlarz');
  assert.ok(rec.arcs.every((a) => a[0] === 800 && a[1] === 450));
});

test('wygładzanie: próg z histerezą — wędrowanie ułamka przy 1 nie daje serii pęknięć', async () => {
  const O = await import('../src/ui/radarRangeOverlay.js');
  const w = soloEnemy(1.1 * 15000 / 1.3);
  const st = O.createThreatLookState();
  const { P, W } = w;
  let t = 1;
  const run = async (n) => { for (let i = 0; i < n; i++, t += 0.05) { SP.updateSensorPicture(P, 0.05, W, true); await drawLook('struna', P, lookView(0.1), st, t); } };
  await run(2);
  const rec = st.smooth.get(P.threats.lead[0]);
  assert.equal(rec.reached, true);
  const at0 = rec.at;
  W.npcs[0].passive = 0.97 * 15000 / 1.3;
  await run(40);
  assert.ok(near(rec.them, 0.97, 1e-3));
  assert.equal(rec.reached, true, '0,97 to jeszcze nie wyjście');
  W.npcs[0].passive = 1.02 * 15000 / 1.3;
  await run(40);
  assert.equal(rec.at, at0, 'bez drugiego błysku');
  W.npcs[0].passive = 0.9 * 15000 / 1.3;
  await run(40);
  assert.equal(rec.reached, false);
});

test('wygładzanie: powrót rekordu po przerwie bez fałszywego pęknięcia; ciągłe przejście przez próg — błysk', async () => {
  const O = await import('../src/ui/radarRangeOverlay.js');
  const w = soloEnemy(0.5 * 15000 / 1.3);
  const st = O.createThreatLookState();
  const { P, W } = w;
  await drawLook('struna', P, lookView(0.1), st, 1);
  const rec = st.smooth.get(P.threats.lead[0]);
  assert.ok(near(rec.them, 0.5, 1e-3));
  // przerwa w rysowaniu (CIC otwarty): obraz żyje, zegar nakładki stoi; them skacze ponad próg
  W.npcs[0].passive = 1.5 * 15000 / 1.3;
  for (let i = 0; i < 5; i++) SP.updateSensorPicture(P, 0, W, true);
  await drawLook('struna', P, lookView(0.1), st, 1.016);
  assert.ok(near(rec.them, 1.5, 1e-3), 'wartość wprost, nie od starej');
  assert.equal(rec.reached, true);
  assert.ok(rec.at < 0, 'bez błysku świeżego wykrycia');
  // ciągły rysunek: przejście przez próg daje chwilę sięgnięcia
  W.npcs[0].passive = 0.5 * 15000 / 1.3;
  for (let i = 0; i < 5; i++) SP.updateSensorPicture(P, 0, W, true);
  await drawLook('struna', P, lookView(0.1), st, 1.032);
  assert.equal(rec.reached, false);
  W.npcs[0].passive = 1.5 * 15000 / 1.3;
  SP.updateSensorPicture(P, 0, W, true);
  let t = 1.05;
  for (let i = 0; i < 60; i++, t += 0.016) await drawLook('struna', P, lookView(0.1), st, t);
  assert.equal(rec.reached, true);
  assert.ok(rec.at > 1, 'chwila sięgnięcia zapisana');
});

test('wachlarz: przy mnie niezależnie od znaku wroga; nakładanie liczone do narysowanych', async () => {
  const O = await import('../src/ui/radarRangeOverlay.js');
  const S = O.RADAR_RANGE_STYLE;
  // gracz nisko pod dolnym marginesem kadru, wróg poniżej kadru: prosta omija prostokąt znaków — mój wachlarz i tak jest
  const w = soloEnemy(18000, 0);
  w.W.npcs[0].x = 0; w.W.npcs[0].y = 15000;
  SP.updateSensorPicture(w.P, 0, w.W, true);
  const v = { ...lookView(0.1), bottomInset: 118, project(x, y, o) { o.x = 800 + x * 0.1; o.y = 880 + y * 0.1; return o; } };
  O.setRadarLook('wachlarz');
  const a = recorder();
  O.drawThreatLook(a.ctx, w.P, v, 800, 880, 30, 1, S, O.createThreatLookState(), 1, true);
  assert.equal(a.rec.arcs.filter((p) => p[0] === 800 && p[1] === 880).length, S.fanArcs, 'mój wachlarz');
  assert.equal(a.rec.arcs.length, S.fanArcs, 'bez znaku wroga — nie ma gdzie stanąć');
  // trzy grupy na namiarach 0 / 0,3 / 0,6 rad (okno 0,4): środkowa odpada, trzecia ma wolne miejsce
  const g = world();
  const at = (ang, passive) => ({ x: Math.cos(ang) * 60000, y: Math.sin(ang) * 60000, side: 'pirate', passive, sig: 0.7, vision: 5000 });
  g.W.npcs = [at(0, 30000), at(0.3, 20000), at(0.6, 15000)];
  g.W.extraSources = null;
  g.P.A.identified = () => true;
  SP.updateSensorPicture(g.P, 0, g.W, true);
  assert.equal(g.P.threats.n, 3);
  const b = recorder();
  O.drawThreatLook(b.ctx, g.P, lookView(0.01), 800, 450, 30, 1, S, O.createThreatLookState(), 1, false);
  assert.equal(b.rec.arcs.filter((p) => p[0] === 800 && p[1] === 450).length, 2 * S.fanArcs, 'dwa moje wachlarze: 0 i 0,6');
});

test('znak wroga przy krawędzi PROSTOKĄTA KADRU (podzielony ekran), nie całej kanwy', async () => {
  const O = await import('../src/ui/radarRangeOverlay.js');
  const S = O.RADAR_RANGE_STYLE;
  const { P } = soloEnemy();
  O.setRadarLook('wachlarz');
  const a = recorder();
  // połówka 0..800, gracz w jej środku; wróg na x = 400 + 1500 poza połówką
  const v = { ...lookView(0.1), vpX: 0, vpY: 0, vpW: 800, vpH: 900, project(x, y, o) { o.x = 400 + x * 0.1; o.y = 450 + y * 0.1; return o; } };
  O.drawThreatLook(a.ctx, P, v, 400, 450, 30, 1, S, O.createThreatLookState(), 1, false);
  const edge = 800 - S.fanEdgeInset;
  assert.equal(a.rec.arcs.filter((p) => Math.abs(p[0] - edge) < 1e-6).length, S.fanArcs);
});

test('wygląd oceny: lista, następny, nazwa spoza listy bez zmiany', async () => {
  const O = await import('../src/ui/radarRangeOverlay.js');
  O.setRadarLook('wachlarz');
  assert.equal(O.nextRadarLook(), 'struna');
  assert.equal(O.nextRadarLook(), 'blona');
  assert.equal(O.nextRadarLook(), 'wachlarz');
  assert.equal(O.setRadarLook('bzdura'), 'wachlarz');
  assert.equal(O.radarLookName(), 'wachlarz');
});

test('fala: suma kół skurczonych do ułamka zasięgu (scaleCoverageInto)', () => {
  const src = C.createCoverage();
  C.beginCoverage(src);
  C.addCoverageCircle(src, 0, 0, 50, 7);
  C.addCoverageCircle(src, 60, 0, 30, 9);
  C.buildCoverage(src);
  assert.equal(src.clusterN, 1);
  const dst = C.createCoverage(2);
  C.scaleCoverageInto(dst, src, 0.5);
  assert.equal(dst.n, 2);
  assert.equal(dst.r[0], 25);
  assert.equal(dst.tag[1], 9);
  assert.equal(dst.clusterN, 2, 'połówki kół się nie stykają');
  C.scaleCoverageInto(dst, src, 0);
  assert.equal(dst.n, 0);
});

test('wpięcie w grę: prototyp za flagą adresu, krok w kroku informacji, nakładka pod CIC, Z w CIC przed myśliwcami', () => {
  const html = read('index.html');
  assert.match(html, /const RADAR_RANGE_PROTO = RADAR_RANGE_QUERY\.has\('radarZasiegi'\);/);
  assert.match(html, /const sensorPicture = RADAR_RANGE_PROTO \? createSensorPicture\(radarRangeAdapters\) : null;/);
  assert.match(html, /CICDisplay\.update\(frameLogicDt, ship, npcs, stations, SensorSystem\);\n\s+\/\/ Zasięg radarów[^\n]*\n\s+stepRadarRangePicture\(frameLogicDt\);/);
  assert.match(html, /if \(radarRangeOverlay && gameStarted && !CICDisplay\.active[^\n]*\n[^\n]*!isView3DCamera\(cam\)\) \{\n\s+drawRadarRangeOverlay\(cam, frameDt\);/);
  assert.match(html, /'cic\.coverage': \{\n\s+gate: \(\) => CICDisplay\.active && CICDisplay\.coverageAvailable,/);
  assert.match(html, /'radar\.look': \{\n\s+gate: \(\) => RADAR_RANGE_PROTO && gameStarted,/);
  const ia = read('src/input/inputActions.js');
  assert.match(ia, /'cic\.coverage': \['KeyZ'\]/);
  assert.match(ia, /'radar\.look': \['BracketRight'\]/);
  const order = ia.slice(ia.indexOf('export const KEYDOWN_ORDER'));
  assert.ok(order.indexOf("'cic.coverage'") > 0 && order.indexOf("'cic.coverage'") < order.indexOf("'wpn.fighters'"),
    'Z w CIC przed myśliwcami (bez prototypu bramka puszcza Z dalej)');
  // moduły UI bez window / DOM gry (szew): nakładka i warstwa CIC czytają tylko obraz i widok
  for (const f of ['src/ui/radarRangeOverlay.js', 'src/ui/cicCoverageLayer.js', 'src/game/sensorPicture.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /\bwindow\./, `${f}: bez window`);
    assert.doesNotMatch(src, /Math\.random/, `${f}: bez Math.random`);
  }
});
