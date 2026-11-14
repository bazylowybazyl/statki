// Demo marek silników frakcji (dema/silniki-marki.html): dane marek, automat faz silnika, mieszanie nastaw strugi
// i grafy TSL strugi oraz blasków (WGSL w Node, bez GPU).
// node --test tests/silnikiMarki.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { MARKI, STANY, POLA_LICZB, POLA_BARW, blendPlume, createPlumeState, FLOW_REF } from '../dema/silniki-marki/marki.js';
import {
  TRYBY, AUTOMAT, FAZY_PL, createEngine, stepEngine, setEngineMode,
  EV_BOOST, EV_HIPER, EV_HIPER_WYJSCIE, EV_WARP, EV_WARP_WYJSCIE
} from '../dema/silniki-marki/automat.js';
import { StrugaBatch } from '../dema/silniki-marki/struga.js';
import { Blaski, Iskry } from '../dema/silniki-marki/blaski.js';

const DT = 1 / 60;

/** Krokuje automat `sek` sekund; zwraca sumę zdarzeń i listę faz po kolei. */
function run(e, sek, onStep) {
  let ev = 0;
  const fazy = [e.phase];
  const n = Math.round(sek / DT);
  for (let i = 0; i < n; i++) {
    stepEngine(e, DT);
    ev |= e.ev;
    if (fazy[fazy.length - 1] !== e.phase) fazy.push(e.phase);
    if (onStep) onStep(e);
  }
  return { ev, fazy };
}

test('marki: sześć marek, każda ma komplet stanów strugi z liczbami skończonymi i dysze za rufą', () => {
  assert.equal(MARKI.length, 6);
  assert.equal(new Set(MARKI.map((m) => m.id)).size, 6);
  assert.equal(new Set(MARKI.map((m) => m.frakcja)).size, 6, 'każda marka innej frakcji');
  for (const m of MARKI) {
    assert.ok(m.dysze.length >= 1 && m.dysze.length <= 4, m.id);
    for (const d of m.dysze) {
      assert.ok(d.x < -150, `${m.id}: dysza za rufą`);
      assert.ok(d.r > 4 && d.rw >= d.r, `${m.id}: promień i półszerokość wylotu`);
    }
    for (const st of STANY) {
      const s = m.struga[st];
      for (const k of POLA_LICZB) assert.ok(Number.isFinite(s[k]), `${m.id}.${st}.${k}`);
      for (const k of POLA_BARW) {
        assert.equal(s[k].length, 3, `${m.id}.${st}.${k}`);
        for (const v of s[k]) assert.ok(Number.isFinite(v) && v >= 0, `${m.id}.${st}.${k}`);
      }
      assert.ok(s.len > 0 && s.wid > 0 && s.taper > 0 && s.dSpacing > 0 && s.pSpacing > 0, `${m.id}.${st}`);
    }
    // Tryby różnią się czytelnie: boost dłuższy niż normalny, hipercruise dłuższy niż boost, warp najdłuższy.
    const { normal, boost, hiper, warp, ladowanie } = m.struga;
    assert.ok(boost.len > normal.len * 1.3, `${m.id}: boost`);
    assert.ok(hiper.len > boost.len * 2, `${m.id}: hipercruise`);
    assert.ok(warp.len > hiper.len * 1.3, `${m.id}: warp`);
    assert.ok(hiper.wid < normal.wid, `${m.id}: hipercruise węższy`);
    assert.ok(hiper.turb < normal.turb || normal.turb < 0.03, `${m.id}: hipercruise spokojniejszy`);
    assert.ok(ladowanie.len < normal.len * 0.5 && ladowanie.flow < 0, `${m.id}: ładowanie cofa strugę, wzór płynie do dyszy`);
  }
});

test('automat: tryby proste przechodzą od razu, boost zgłasza zdarzenie, kanały zostają w zakresie', () => {
  const e = createEngine();
  assert.equal(e.phase, 'jalowy');
  setEngineMode(e, 'normalny');
  let r = run(e, 2);
  assert.equal(e.phase, 'normalny');
  assert.ok(e.thr > 0.98 && e.boost < 0.01);
  setEngineMode(e, 'boost');
  r = run(e, 1.5);
  assert.ok(r.ev & EV_BOOST);
  assert.ok(e.boost > 0.98);
  setEngineMode(e, 'jalowy');
  run(e, 3, (s) => {
    for (const k of ['thr', 'boost', 'hyper', 'charge', 'warp', 'kick', 'flash', 'chase']) assert.ok(s[k] >= 0 && s[k] <= 1.0001, `${k} = ${s[k]}`);
    assert.ok(s.heat >= 0 && s.heat <= 1.1001 && s.lamp >= 0 && s.lamp <= 1.5);
  });
  assert.ok(Math.abs(e.thr - AUTOMAT.idleThr) < 0.01);
  setEngineMode(e, 'nie-ma-takiego');
  assert.equal(e.mode, 'jalowy');
  for (const t of TRYBY) assert.ok(FAZY_PL[t] || t === 'hiper' || t === 'warp');
});

test('automat: hipercruise ma rozruch (żar bez strugi hipercruise\'u), zapłon z pchnięciem i wyjście', () => {
  const e = createEngine();
  setEngineMode(e, 'normalny');
  run(e, 2);
  setEngineMode(e, 'hiper');
  let r = run(e, AUTOMAT.hyperSpool - 0.1);
  assert.equal(e.phase, 'hiper-rozruch');
  assert.ok(e.hyper < 0.01, 'w rozruchu struga hipercruise\'u jeszcze nie rośnie');
  assert.ok(e.heat > 0.5, 'osprzęt się żarzy');
  assert.equal(r.ev & EV_HIPER, 0);
  r = run(e, 0.3);
  assert.ok(r.ev & EV_HIPER);
  assert.equal(e.phase, 'hiper');
  assert.ok(e.kick > 0.3, 'pchnięcie zapłonu');
  run(e, 2);
  assert.ok(e.hyper > 0.99 && e.speed > AUTOMAT.speed.boost);
  setEngineMode(e, 'normalny');
  r = run(e, AUTOMAT.hyperDrop + 1.5);
  assert.ok(r.ev & EV_HIPER_WYJSCIE);
  assert.deepEqual(r.fazy, ['hiper', 'hiper-wyjscie', 'normalny']);
  assert.ok(e.hyper < 0.02);
  // Przerwany rozruch wraca bez zapłonu.
  setEngineMode(e, 'hiper');
  run(e, 0.5);
  setEngineMode(e, 'jalowy');
  r = run(e, 2);
  assert.equal(r.ev & EV_HIPER, 0);
  assert.equal(e.phase, 'jalowy');
});

test('automat: warp ładuje się liniowo, skacze z błyskiem i wychodzi przez fazę wyjścia; z hipercruise\'u przez wyjście', () => {
  const e = createEngine();
  setEngineMode(e, 'warp');
  let last = -1;
  let r = run(e, AUTOMAT.warpCharge - 0.05, (s) => {
    if (s.phase === 'warp-ladowanie') { assert.ok(s.charge >= last - 1e-9, 'ładowanie nie maleje'); last = s.charge; }
  });
  assert.equal(e.phase, 'warp-ladowanie');
  assert.ok(e.charge > 0.95 && e.warp < 0.01);
  r = run(e, 0.2);
  assert.ok(r.ev & EV_WARP);
  assert.equal(e.phase, 'warp');
  assert.ok(e.flash > 0.2);
  run(e, 1.5);
  assert.ok(e.warp > 0.99 && e.charge < 0.01 && e.speed > 0.9);
  setEngineMode(e, 'jalowy');
  r = run(e, AUTOMAT.warpExit + 2);
  assert.ok(r.ev & EV_WARP_WYJSCIE);
  assert.deepEqual(r.fazy, ['warp', 'warp-wyjscie', 'jalowy']);
  assert.ok(e.warp < 0.01);
  // Hipercruise → warp: najpierw wyjście z hipercruise'u, potem ładowanie.
  setEngineMode(e, 'hiper');
  run(e, 4);
  setEngineMode(e, 'warp');
  r = run(e, AUTOMAT.hyperDrop + AUTOMAT.warpCharge + 0.5);
  assert.deepEqual(r.fazy, ['hiper', 'hiper-wyjscie', 'warp-ladowanie', 'warp']);
  // Krok o zerowym czasie nic nie zmienia i kasuje zdarzenia.
  const przed = JSON.stringify(e);
  stepEngine(e, 0);
  assert.equal(e.ev, 0);
  assert.equal(JSON.stringify({ ...e, ev: JSON.parse(przed).ev }), przed);
});

test('mieszanie nastaw: liczby skończone w całym pokazie, długość rośnie z trybem, smugi wydłużają się z przepływem', () => {
  for (const m of MARKI) {
    const e = createEngine();
    const P = createPlumeState();
    const len = {};
    const plan = [['normalny', 2.5], ['boost', 2.5], ['hiper', 5], ['warp', 7], ['jalowy', 4]];
    for (const [tryb, sek] of plan) {
      setEngineMode(e, tryb);
      run(e, sek, (s) => {
        blendPlume(m, s, P);
        for (const k of POLA_LICZB) assert.ok(Number.isFinite(P[k]), `${m.id} ${s.phase} ${k}`);
        for (const k of POLA_BARW) for (const v of P[k]) assert.ok(Number.isFinite(v) && v >= 0, `${m.id} ${s.phase} ${k}`);
        assert.ok(P.len > 0 && P.wid > 0 && P.gain > 0 && P.stretch >= 1, `${m.id} ${s.phase}`);
        assert.ok(Math.abs(P.flow) / P.stretch <= FLOW_REF + 1e-6, `${m.id} ${s.phase}: przepływ wzoru pod progiem stroboskopu`);
      });
      len[tryb] = P.len;
    }
    assert.ok(len.boost > len.normalny && len.hiper > len.boost && len.warp > len.hiper, `${m.id}: ${JSON.stringify(len)}`);
    assert.ok(len.jalowy < len.normalny * 0.4, `${m.id}: jałowy to płomyk`);
  }
  // Mieszanie nie alokuje nowych tablic barw (pisze w miejscu).
  const P = createPlumeState();
  const core = P.core;
  blendPlume(MARKI[0], createEngine(), P);
  assert.equal(P.core, core);
});

function buildWgsl(mesh) {
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = mesh.material;
  b.build();
  return b;
}

test('obraz: graf strugi i blasków buduje się do WGSL w Node; jeden bufor instancji, mieszanie addytywne', () => {
  const scene = new THREE.Scene();
  const strugi = new StrugaBatch({ scene });
  const blaski = new Blaski({ scene, capacity: 64 });
  for (const sys of [strugi, blaski]) {
    const b = buildWgsl(sys.mesh);
    assert.ok(b.vertexShader.length > 100 && b.fragmentShader.length > 100, sys.mesh.name);
    const bufs = new Set();
    for (const a of Object.values(sys.mesh.geometry.attributes)) bufs.add(a.isInterleavedBufferAttribute ? a.data : a);
    assert.equal(bufs.size, 3, `${sys.mesh.name}: pozycja, uv i jeden bufor instancji`);
    const m = sys.mesh.material;
    assert.equal(m.blendSrc, THREE.OneFactor);
    assert.equal(m.blendDst, THREE.OneFactor);
    assert.equal(m.depthWrite, false);
    assert.equal(m.forceSinglePass, true);
  }
  // Struga każdej marki w każdym stanie zapisuje pełny rekord instancji bez NaN.
  const P = createPlumeState();
  strugi.begin();
  for (const m of MARKI) {
    for (const [tryb, sek] of [['normalny', 2], ['warp', 5]]) {
      const e = createEngine();
      setEngineMode(e, tryb);
      run(e, sek);
      blendPlume(m, e, P);
      for (const d of m.dysze) strugi.add(d.x, d.y, 0, -1, 0, d.r, d.rw, P, P.gain, 12.5, 0.3, d.seed, 0, d.kLen);
    }
  }
  assert.ok(strugi.count > 0 && strugi.count <= strugi.capacity);
  for (let i = 0; i < strugi.count * 44; i++) assert.ok(Number.isFinite(strugi.data[i]), `rekord strugi [${i}]`);
  // Sufit luminancji ciała jednej strugi: pod progiem bloomu gry (0,9).
  for (let i = 0; i < strugi.count; i++) {
    const o = i * 44;
    for (const base of [32, 36]) {
      const lum = 0.2126 * strugi.data[o + base] + 0.7152 * strugi.data[o + base + 1] + 0.0722 * strugi.data[o + base + 2];
      assert.ok(lum <= 0.7201, `luminancja ciała ${lum}`);
    }
  }
});

test('iskry: pierścień bez alokacji, życie się kończy, iskry ładowania lecą do celu', () => {
  const iskry = new Iskry(32);
  for (let i = 0; i < 40; i++) iskry.emit(0, 0, 0, 100, 0, 0.5, 1, 1, 1, 1);
  iskry.update(DT);
  assert.equal(iskry.alive, 32, 'pierścień nadpisuje najstarsze');
  for (let i = 0; i < 40; i++) iskry.update(DT);
  assert.equal(iskry.alive, 0);
  const slot = iskry.head;
  iskry.emit(100, 0, 0, -200, 0, 0.5, 1, 1, 1, 1, 1);
  for (let i = 0; i < 29; i++) iskry.update(DT);
  assert.ok(Math.abs(iskry.data[slot * 12] - (100 - 200 * 29 * DT)) < 1e-3, 'iskra ładowania leci ze stałą prędkością (bez oporu)');
  const r = [];
  for (let i = 0; i < 200; i++) r.push(iskry.rnd());
  assert.ok(Math.min(...r) >= 0 && Math.max(...r) < 1 && new Set(r).size > 150, 'własny ciąg losowy w [0, 1)');
});
