// Strona dema wiązanych wokseli (docs/SPEC-woksele-zawalenia.md § 5.1, § 8). Pakiet P1: renderer, rozgrzewka kerneli, znaczniki czasu, API window.__wok. Bez obrazu.
// ?test=1 dokłada window.__wok.test (test GPU z Node, testGpu.js). ?profil=1: każdy kernel własnym renderer.compute, czasy kF, kI, kLista osobno, wynik tylko do proporcji (§ 8).
import * as THREE from 'three/webgpu';
import { createWokseleSolver } from './solver.js';
import { S1, S2, S3, S4, stanie } from './scena.js';
import { zbuduj, PARAMETRY } from './budowa.js';

const parametryAdresu = new URLSearchParams(location.search);
const TEST = parametryAdresu.get('test') === '1';
const PROFIL = parametryAdresu.get('profil') === '1';

const wok = { gotowe: false, blad: null, profil: PROFIL };
window.__wok = wok;

const ZR_OBROT = Object.freeze({ obrot: { p: [0, 0, -3000], os: [1, 0.2, 0], om: 0.3 } });
const ZR_PUNKT = Object.freeze({ punkt: { c: [300, 0, -6000], g: 300, r0: 2000 } });
const PLANY = {
  S1, S2, S3, S4, W1: stanie,
  // Źródła grawitacji § 10.4 z biegów P0 (tests/helpers/wokseleBiegi.mjs): tylko do testu gałęzi [G], w pokazie jeszcze ich nie ma.
  S4obrot: () => S4({ zrodlo: ZR_OBROT, gRef: 300 }),
  S4punkt: () => S4({ zrodlo: ZR_PUNKT, gRef: 300 }),
  S4grunt: () => S4({ g: 400, grunt: true, kotwice: true }),
};
const NA_KOLEJKE = 8; // tyle kroków najwyżej w kolejce GPU, potem czekanie: bez zatykania przy krok(3600)

/**
 * three r183 (Backend.updateTimeStampUID): tablica nie ma isComputeNode ani id, więc każda lista dostaje uid r:0:undefined:f0,
 * pula nadpisuje wpis i zostaje ostatnia lista (§ 8, pkt 1). Wzór Core3D._uniqueComputeListTimestamps. Ta sama łata w demie, bo renderer jest własny.
 */
function latajUidList(renderer) {
  const backend = renderer.backend;
  const orig = backend.updateTimeStampUID;
  const ids = new WeakMap();
  let nast = 1;
  backend.updateTimeStampUID = function (ctx) {
    if (!Array.isArray(ctx)) return orig.call(this, ctx);
    let id = ids.get(ctx);
    if (id === undefined) { id = nast++; ids.set(ctx, id); }
    const info = this.renderer.info;
    this.get(ctx).timestampUID = 'c:' + info.compute.frameCalls + ':L' + id + ':f' + info.frame;
  };
}

/** adapter.info urządzenia, na którym naprawdę liczy renderer. Pola programistyczne (backend, type, driver) tylko przy --enable-webgpu-developer-features. */
function opisAdaptera(device) {
  const info = device.adapterInfo;
  const o = {};
  if (info) for (const k in info) { const v = info[k]; if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') o[k] = v; }
  return o;
}

async function start() {
  const renderer = new THREE.WebGPURenderer({ powerPreference: 'high-performance', antialias: false, trackTimestamp: true });
  await renderer.init();
  if (!renderer.backend.isWebGPUBackend) throw new Error('Demo wymaga WebGPU (three przeszedł na zapasowy backend WebGL2).');
  const backend = renderer.backend;
  const device = backend.device;
  wok.adapter = opisAdaptera(device); // od razu: harness odmawia przed rozgrzewką, a na karcie zintegrowanej kompilacja kF trwa minuty
  latajUidList(renderer);
  backend.trackTimestamp = false; // znaczniki tylko w krokach mierzonych: pula ma 1024 pary, a przebiegi testu mają tysiące list
  const bledy = [];
  device.addEventListener('uncapturederror', (e) => {
    bledy.push(String(e.error?.message || e.error));
    console.error('WEBGPU', e.error?.message || e.error);
  });
  device.lost?.then((i) => { bledy.push(`utrata urządzenia: ${i?.message}`); console.error('WEBGPU utrata urządzenia', i?.message); });

  // Harness zakłada hak dziennika pipeline'ów timerem co 10 ms, gdy zobaczy ten renderer: najpierw hak, potem rozgrzewka, inaczej „0 synchronicznych” to fałszywe zero.
  window.__HARNESS_RENDERER__ = renderer;
  if (window.__harness) {
    for (let i = 0; i < 200 && !backend.pipelineUtils.__harnessHook; i++) await new Promise((ok) => setTimeout(ok, 10));
    if (!backend.pipelineUtils.__harnessHook) throw new Error('Hak dziennika pipeline\'ów harnessu się nie założył');
  }

  // ?maxWez=N: pojemność buforów na scenę większą niż dzisiejsze (pomiar LOD, miasto). Domyślnie 26000: bufory i kernele jak dotąd.
  const solver = createWokseleSolver({ maxNodes: Number(parametryAdresu.get('maxWez')) || 26000, par: PARAMETRY });
  await solver.rozgrzej(renderer);

  const pamiecStatyki = new Map();
  const wypieki = new Map();
  const wypiekSceny = (id) => {
    let w = wypieki.get(id);
    if (!w) {
      const plan = PLANY[id];
      if (!plan) throw new Error(`Nieznana scena ${id}`);
      const p = plan();
      w = zbuduj(p.scena, PARAMETRY, { pamiecStatyki });
      wypieki.set(id, w);
    }
    return w;
  };

  // ── Czasy ── ms na KROK, z par znaczników. Pętla bez rAF, więc querySet nie jest nadpisywany (§ 8, pkt 2).
  const pustyCzas = () => ({ fizyka: [], lista: [], kF: [], kI: [], kWstaw: [], kLista: [], kZerujPo: [] });
  let czasy = pustyCzas();
  const pula = () => backend.timestampQueryPool?.compute;
  const czytajZnacznik = (uid) => {
    const t = pula().timestamps;
    const ms = t.get(uid);
    t.delete(uid);
    return ms;
  };

  /** Jeden krok ze znacznikami. W ?profil=1 każdy kernel osobno, inaczej jedna lista. Zwraca po przyjściu wyniku z GPU. */
  async function krokMierzony() {
    backend.trackTimestamp = true;
    if (PROFIL) {
      const uidy = [];
      for (const [nazwa, kernel] of solver.sekwencja) {
        renderer.compute(kernel);
        uidy.push(nazwa, backend.get(kernel).timestampUID);
      }
      await renderer.resolveTimestampsAsync('compute');
      backend.trackTimestamp = false;
      const suma = { kF: 0, kI: 0, kWstaw: 0, kLista: 0, kZerujPo: 0 };
      for (let i = 0; i < uidy.length; i += 2) suma[uidy[i]] += czytajZnacznik(uidy[i + 1]);
      for (const k in suma) czasy[k].push(suma[k]);
    } else {
      solver.krok(renderer);
      const uid = backend.get(solver.listaKroku).timestampUID;
      await renderer.resolveTimestampsAsync('compute');
      backend.trackTimestamp = false;
      czasy.fizyka.push(czytajZnacznik(uid));
    }
  }

  /** Sama siatka i lista kontaktów jako własna lista, na zatrzymanym stanie: czas `lista` z § 8. Jeden pomiar na wywołanie. */
  async function listaMierzona() {
    backend.trackTimestamp = true;
    renderer.compute(solver.listaSiatki);
    const uid = backend.get(solver.listaSiatki).timestampUID;
    await renderer.resolveTimestampsAsync('compute');
    backend.trackTimestamp = false;
    const ms = czytajZnacznik(uid);
    czasy.lista.push(ms);
    return ms;
  }

  /** Dowolna lista kerneli ze znacznikiem: test „dwie listy o znanym stosunku pracy dają dwa niezerowe czasy” (§ 8, pkt 8). */
  async function zmierzListe(lista) {
    backend.trackTimestamp = true;
    renderer.compute(lista);
    const uid = backend.get(lista).timestampUID;
    await renderer.resolveTimestampsAsync('compute');
    backend.trackTimestamp = false;
    return czytajZnacznik(uid);
  }

  Object.assign(wok, {
    bledy: () => bledy.slice(),
    /** Budowa sceny i wczytanie (§ 2.2). Budowa na stronie, bez workera: P1 nie ma obrazu, a strona i tak czeka. */
    ustawScene(id) {
      const w = wypiekSceny(id);
      solver.wczytaj(w);
      return { id, n: w.n, capEtyk: w.capEtyk, rama: w.rama, gProj: w.gProj, K: w.K };
    },
    wgraj(stan) { solver.wgraj(stan); return true; },
    /** n kroków 1/60 s. Zegar ręczny: bez rAF, kolejka GPU trzymana krótko, czas liczenia nie zależy od czasu rzeczywistego. */
    async krok(n = 1, { mierz = false } = {}) {
      for (let k = 0; k < n; k++) {
        if (mierz) await krokMierzony();
        else if (PROFIL) { for (const [, kernel] of solver.sekwencja) renderer.compute(kernel); } else solver.krok(renderer);
        if (!mierz && (k + 1) % NA_KOLEJKE === 0) await device.queue.onSubmittedWorkDone();
      }
      await device.queue.onSubmittedWorkDone();
      return n;
    },
    odczyt() { return solver.odczyt(renderer); },
    czasy() { return czasy; },
    wyczyscCzasy() { czasy = pustyCzas(); return true; },
    listaMierzona,
    zmierzListe,
    ziarnoBudowy() { return PARAMETRY.ziarno; },
  });

  if (TEST) {
    const { createTestGpu } = await import('./testGpu.js');
    wok.test = createTestGpu({ renderer, solver, wypiekSceny, wok, device });
    const { createTestS5 } = await import('./testS5.js');
    wok.test.s5 = createTestS5({ renderer, solver, wok }).s5;
    const { createTestLod } = await import('./testLod.js');
    wok.test.lod = createTestLod({ renderer, solver, wok });
  }
  // AGENT: tryby ?test=1 i ?profil=1 zostają bez obrazu: narzędzie P1 mierzy nimi fizykę bez kanwy i bez pętli rAF.
  if (!TEST && !PROFIL) {
    const { startPokaz } = await import('./pokaz.js');
    await startPokaz({ renderer, solver, wypiekSceny, wok, device, adres: parametryAdresu });
  }
  wok.gotowe = true;
}

start().catch((e) => {
  wok.blad = String(e?.stack || e);
  console.error('woksele: start nieudany', e);
});
