// Demo: HUTA — WYTOP (element 2 huty: kula ciekłego metalu w nieważkości między segmentami cewek indukcyjnych).
//   /dema/huta-wytop.html   (?metal=0|1, ?view=1…7, ?tempo=0.25|1|2, ?shot=1 — bez panelu i pętli: klatki z API,
//                            ?gaz=0 — bez pola gazu, ?gazJakosc=0|1|2 — preset pola: oszczędny, zwykły, wysoki)
// GAZ (runda 5): symulacja liczy gaz komory (źródła, kąpiel, odciąg, rura zbiorcza, zbiorniki tlenu); rekordy źródeł
// zabiera tu `takeGas` po każdym kroku, a `gazWejscie.js` składa z nich i ze stanu wejście kroku POLA GAZU — ośrodka
// symulowanego na GPU (`gazKrok.js`: krok `Core3D.addFxStep`, siatka `gazSiatka.js`, obraz `gazObraz.js`: marsz
// promienia w bryle studni + drganie powietrza nad gorącym gazem). Bryły odciągu i wskaźniki tlenu: `obraz.js`.
// Cykl v2: pusta komora → kupa rudy → docisk i topienie w małą kulę → dokarmianie i rafinacja → zrzut grawitacyjny
// do leja (całe dno komory), z bryłami metalu odbijającymi się od stożka. Sygnał grawitacji: wyświetlacz na ścianie
// (szewrony krążą → stają → obracają się w dół → płyną w dół). Symulacja: `dema/ring-dzielnice/huta/wytop/komora.js` (czysty JS na wątku strony — krok ok. 0,2 ms), obraz:
// `obraz.js` (kula z wyspami żużla, wyposażenie komory ze ssawą, ziarna, nitka i granulki żużla, iskry), pokład z zestawu portowego: `scena.js`. Potok renderu
// gry (Core3D). Pętla idzie od razu: przy starcie cykl już trwa (kupa rudy w 2/3 usypana, struga płynie).
// Komora jest studnią pod pokładem: środek kuli `KOMORA.deckY` (400 j.) pod płaszczyzną gry (pod pokładem zestaw nie ściska wysokości).
// RUNDA 6 („złóż wszystko”, element 3 — formowanie): komora stoi NAD pokładem HALI (`KOMORA.hallY`, 1 700 j. pod
// płaszczyzną) jako naczynie-lejek; wnętrze bez zmian. Bryły naczynia z zewnątrz, nośna, pomost górny, hala z
// fundamentami i stykami linii, rura tlenu ze zbiornikami i dok żużla: `dema/ring-dzielnice/huta/formowanie/`
// (`ZlozenieObraz`). Widoki 1 (kamera gry nad naczyniem i linią), 7 (zbiorniki w hali), 8 (przejęcie i gięcie),
// 9 (walcowanie), 0 (z boku — całość). `?linia=0` — bez linii formowania (A/B kosztu), `?linia=zimna` — start od
// pustej linii (pierwsze czoło z pierwszego spływu).
// PASMO W POLU (runda 6, element 3): metal z gardzieli (przyrost `LICZNIK.delivered` w kroku = dopływ linii) leci strugą,
// pole łapie ją pod dyszą, gnie łukiem w poziom i wlewa do zasobnika w kołysce; wylot G0 wyciąga pasmo, bramy G1–G4
// spłaszczają je w taśmę, chłodnice studzą, metal krzepnie (`formowanie/linia.js` — czysty JS, krok po kroku komory;
// obraz `formowanie/obrazLinii.js`: jedna rura metalu w TSL, światło linii na otoczeniu, emitery pola).
// WYLOT BOKIEM i BŁONA POLA (etap „Kropla”, decyzja użytkownika: „Tak, wylot bokiem”): metal z gardzieli płynie rurą
// spustową pod stożkiem poza obrys naczynia, z wylewki (zawór z klapami) leje się łukiem w pierścieniach pola z góry do
// BŁONY — rękawa pola obok naczynia; ZACISK POLA wędruje od tyłu rękawa ku gardzieli (bramki pola zapalane po kolei), metal wychodzi WYCISKANY
// przez gardziel formującą G0 w taśmę (+x). Widoki 1 (kamera gry), 8 (wylewka i błona z ukosa), 0 (z boku).
// WALCOWANIE (etap „Walcowanie”): klatki F1–F3 (`formowanie/walcownia.js` — kinematyka ciała stałego linii, chwyty,
// pętle, kąty walców; bryły `walcowniaBryly.js` w siatce otoczenia) walcują taśmę 30 → 20 → 13 → 9 j.; iskry i płatki
// zgorzeliny przy chwycie (runda 7: `zgorzelina.js` + `zgorzelinaTSL.js`), błysk chwytu (światło [14]), brama „DO ZWIJARKI” z osłoną tunelu.
// Widok 9 — walcownia od strony obsługi; `?walcownia=0` — otwarte klatki (A/B); API `__wytop.linia.walcownia()`.
import * as THREE from 'three';
import { Core3D } from '../src/3d/core3d.js';
import { drawHexShips3D, initHexShips3D, resizeHexShips3D, updateHexShips3D } from '../src/3d/hexShips3D.js';
import { Fx3D } from '../src/3d/fxParticles3D.js';
import { SimClock } from '../src/game/simClock.js';
import { WARIANT_INSTANCJI } from '../src/3d/rozgrzewka.js';
import { resolvePortBuildingStyle } from '../src/3d/portBuildings/portBuildingStyle.js';
import { portHubMatrixElements, portModuleFrame } from '../src/3d/portBuildings/portModuleTraffic.js';
import { PortBuilding3D } from '../src/3d/portBuildings/portBuildings3D.js';
import { KOMORA } from './ring-dzielnice/huta/wytop/geometria.js';
import { DSP, DSP_NAMES, LICZNIK, PHASE_NAMES, STAN, UNITS_PER_TON, createMeltChamber } from './ring-dzielnice/huta/wytop/komora.js';
import { GAZ, GAZ_SLOTS, GAZ_STRIDE } from './ring-dzielnice/huta/wytop/gaz.js';
import { createWytopGaz } from './ring-dzielnice/huta/wytop/gazKrok.js';
import { createGasInput, createGasPacker, gasBodyOf } from './ring-dzielnice/huta/wytop/gazWejscie.js';
import { METALE, metalOf } from './ring-dzielnice/huta/wytop/metale.js';
import { WytopObraz } from './ring-dzielnice/huta/wytop/obraz.js';
import { buildMeltDeckScene } from './ring-dzielnice/huta/wytop/scena.js';
import { WIDOKI } from './ring-dzielnice/huta/formowanie/geometria.js';
import { ZlozenieObraz } from './ring-dzielnice/huta/formowanie/obrazZlozenia.js';
import { createNozzleValve, createSlagDock } from './ring-dzielnice/huta/formowanie/stanZlozenia.js';
import { LIN_STAN, LIN_WEJ, LIN_WEJ_N, PASMO, TRYB_NAMES, createFormingLine, openMill } from './ring-dzielnice/huta/formowanie/linia.js';
import { LiniaObraz } from './ring-dzielnice/huta/formowanie/obrazLinii.js';
import { WALC, createRollingMill } from './ring-dzielnice/huta/formowanie/walcownia.js';
import { createLineSparks } from './ring-dzielnice/huta/formowanie/iskry.js';
import { createScaleDebris } from './ring-dzielnice/huta/formowanie/zgorzelina.js';
import { BLONA, HALA, LINIA, NACZYNIE, PATH } from './ring-dzielnice/huta/formowanie/geometria.js';
// (runda 8) DZIELENIE taśmy na arkusze: nóż polowy (`../dzielenie/`); (runda 9) lot i chwyt arkusza, grzebień, kasety
import { ARK, ARK_CAP, ARK_N, ARK_ST, ARK_ST_NAMES, LICZ, MARSZ, NOZ, NOZ_ST_NAMES, createDivider } from './ring-dzielnice/huta/dzielenie/model.js';
import { KAS, KAS_CAP, KAS_N, KAS_ST, KAS_ST_NAMES } from './ring-dzielnice/huta/dzielenie/stojak.js';
import { DzielenieObraz } from './ring-dzielnice/huta/dzielenie/obraz.js';
import { PASS_Y as DZ_PASS_Y, WIDOKI_DZ } from './ring-dzielnice/huta/dzielenie/geometria.js';

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot') === '1';
if (shotMode) document.body.classList.add('shot');
const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DT = 1 / 60;

// ---------------------------------------------------------------------------
// Błędy na ekranie
const errors = [];
function reportError(text) {
  errors.push(String(text).slice(0, 2000));
  const el = $('errors');
  el.style.display = 'block';
  el.textContent = errors.join('\n\n');
  console.error(text);
}
addEventListener('error', (e) => reportError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => reportError(`Promise: ${e.reason?.stack || e.reason}`));

// ---------------------------------------------------------------------------
// Core3D jak w grze (kanwa WebGPU pod spodem, klatka kopiowana na 2D)
const canvas2d = $('c');
const ctx2d = canvas2d.getContext('2d');
const glCanvas = $('webgl-layer');
let W = canvas2d.width = innerWidth;
let H = canvas2d.height = innerHeight;
glCanvas.width = W;
glCanvas.height = H;
initHexShips3D({ canvas: glCanvas });
addEventListener('resize', () => {
  W = canvas2d.width = innerWidth;
  H = canvas2d.height = innerHeight;
  resizeHexShips3D(W, H);
});

// Początek układu daleko od zera (precyzja float32 jak w grze); Słońce gry z lewej od góry kadru, nisko nad pokładem:
// studnia jest ciemna, słońce kładzie sierp na przeciwległej ścianie i ostry błysk na kuli.
const P0 = Object.freeze({ x: 7_080_000, y: 6_290_000 });
window.SUN = { x: P0.x - 1_000_000, y: P0.y - 640_000, r: 2600 };
const SUN_ELEVATION = 31;
const SUN_OPTS = { sun: window.SUN, at: P0, elevationDeg: SUN_ELEVATION };
const TICK = { daylight: 0.35, lampPower: 1.1 };

(function addStars() {
  const n = 3200;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let seed = 9173;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (rnd() - 0.5) * 900000;
    pos[i * 3 + 1] = (rnd() - 0.5) * 620000;
    pos[i * 3 + 2] = -90000 - rnd() * 40000;
    const b = Math.pow(rnd(), 6) * 1.2 + 0.05;
    const tint = rnd();
    col[i * 3] = b * (0.85 + 0.15 * tint);
    col[i * 3 + 1] = b * 0.92;
    col[i * 3 + 2] = b * (1.05 - 0.15 * tint);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
  pts.frustumCulled = false;
  pts.position.set(P0.x, -P0.y, 0);
  pts.layers.set(1);
  Core3D.scene.add(pts);
})();

const host = new THREE.Group();
host.name = 'Komora wytopu (gospodarz)';
host.position.set(P0.x, -P0.y, 0);
Core3D.scene.add(host);
const LAYER_BG = 1;
const LAYER_FG = 2;
// Ramka: x komory = +X sceny, z komory = −Y sceny (= +y gry, w dół ekranu).
const FRAME = portModuleFrame(0, 0, -Math.PI / 2);
const style = resolvePortBuildingStyle('earth');

// ---------------------------------------------------------------------------
// Stan strony i symulacja (wątek strony, krok stały 1/60 s)
const state = {
  view: 1,
  mode: 'top',                  // top | cine
  cam: { x: P0.x, y: P0.y, zoom: 0.8, roll: 0 },
  metal: clamp(Number(params.get('metal')) | 0, 0, 1),
  speed: Number(params.get('tempo')) > 0 ? Number(params.get('tempo')) : 1,
  paused: false,
  fps: 60
};
const sim = createMeltChamber({ seed: 7, metal: state.metal, prewarm: true });
const S = sim.view.stan;
const C = sim.counters;
let obraz = null;
let deck = null;
let zl = null;                  // obraz otoczenia (naczynie z zewnątrz, nośna, hala, tlen, dok żużla)
const lineOn = params.get('linia') !== '0';
const lineCold = params.get('linia') === 'zimna';
// LINIA FORMOWANIA: wejście kroku z komory (metal oddany gardzielą w kroku, temperatura, głębokość jeziora, wir)
// WALCOWNIA F1–F3 (etap „Walcowanie”): kinematyka ciała stałego linii; `?walcownia=0` — otwarte klatki (A/B)
const millOn = params.get('walcownia') !== '0';
const mill = millOn ? createRollingMill() : openMill();
// DZIELENIE (runda 8): model liczony w podkroku linii; `?dzielenie=0` — bez noża (taśma kończy się na x 4300, A/B kosztu),
// (runda 9) `?odbior=stop` — kaseta zostaje w odbiorze (bufor grzebienia się zapełnia, przepełnienie → przetop),
// `?chwyt=0` — listwa nie łapie (wszystko leci w osi do przetopu — A/B, awaria)
const divOn = lineOn && params.get('dzielenie') !== '0';
const divider = divOn ? createDivider({ seed: 17, odbior: params.get('odbior') === 'stop' ? 'stop' : 'auto', chwyt: params.get('chwyt') !== '0' }) : null;
// (runda 9, „Gorętsza taśma”) noże C3 za F3 trzyma regulator temperatury końca walcowania; `?c3=1` — dawne pełne
// dmuchanie (taśma za F3 ok. 900 K — A/B), `?c3=0` — noże wyłączone
const c3Param = params.get('c3');
const c3Fixed = c3Param !== null && c3Param !== '' && Number.isFinite(+c3Param) ? Math.max(0, Math.min(1, +c3Param)) : null;
// (runda 9, „Czysta stal”) STACJA ODZGORZANIA za F3 i KURTYNA OSŁONY (argon) — `?odzgorzanie=0`: A/B bez stacji i osłony
// (tlenek rośnie aż do noża, arkusze z łuską jak w rundzie 8; bryły stoją, emitery zgaszone)
const descaleOn = params.get('odzgorzanie') !== '0';
const line = lineOn ? createFormingLine({ seed: 11, metal: state.metal, cold: lineCold, kin: mill, divider, reg: c3Fixed === null ? null : { c3: c3Fixed }, descale: descaleOn }) : null;
let dz = null;                  // obraz dzielenia (`DzielenieObraz`)
const kerfSpark = new Float64Array(2);   // iskry szczeliny: z ostatniej emisji, kierunek przemiatania
const linIn = new Float64Array(LIN_WEJ_N);
let linDelivered = C[LICZNIK.delivered];
let linia = null;               // obraz linii (`LiniaObraz`)
const lineSparks = line ? createLineSparks(23) : null;
// (runda 7) zgorzelina i iskry przy chwycie walców F1–F3 — własna pula i materiał (`zgorzelina.js`, `zgorzelinaTSL.js`)
const scaleDebris = line && millOn ? createScaleDebris(31) : null;
const linTiming = { stepMs: 0 };
const G0X = LINIA.gates[0].x;
/** Stan linii dla panelu, API i raportu harnessu. */
function lineStats() {
  if (!line) return null;
  const LS = line.stan;
  const au = line.audit();
  const t = line.tons();
  const r1 = (v) => +(+v).toFixed(1);
  return {
    tryb: TRYB_NAMES[LS[LIN_STAN.mode]], wylot: LS[LIN_STAN.attached] > 0, czas: r1(LS[LIN_STAN.time]),
    tony: { rura: r1(t.rura), struga: r1(t.struga), blona: r1(t.blona), zasobnik: r1(t.zasobnik), pasmo: r1(t.pasmo), wyszlo: r1(t.wyszlo) },
    Q: +LS[LIN_STAN.Q].toFixed(3), Qzad: +LS[LIN_STAN.Qcmd].toFixed(3), v: r1(LS[LIN_STAN.vLine]), aOut: +LS[LIN_STAN.aOut].toFixed(3),
    blona: { scisk: +LS[LIN_STAN.sq].toFixed(3), napiecie: +LS[LIN_STAN.pT].toFixed(3), L: r1(LS[LIN_STAN.resL]), W: r1(LS[LIN_STAN.memW]), H: r1(LS[LIN_STAN.memH]), tyl: r1(LS[LIN_STAN.memXb]), wejscie: [r1(LS[LIN_STAN.hitX]), r1(LS[LIN_STAN.hitY])], wgniecenie: r1(LS[LIN_STAN.dent]), fala: +LS[LIN_STAN.etaE].toFixed(4), zacisk: { x: r1(LS[LIN_STAN.pinX]), posuw: r1(LS[LIN_STAN.pinV]), sila: +LS[LIN_STAN.pinF].toFixed(3), r: +LS[LIN_STAN.pinR].toFixed(3), rCel: +LS[LIN_STAN.pinRt].toFixed(3), otwiera: LS[LIN_STAN.opening] > 0, wpadanie: r1(LS[LIN_STAN.landX]) } },
    zawor: +LS[LIN_STAN.spout].toFixed(3),
    czolo: LS[LIN_STAN.front] > 0 ? r1(LS[LIN_STAN.front] - PATH.xOff) : null,
    ogon: LS[LIN_STAN.tail] > 0 ? r1(LS[LIN_STAN.tail] - PATH.xOff) : null,
    front: LS[LIN_STAN.frontSolid] > 0 ? r1(LS[LIN_STAN.frontSolid] - PATH.xOff) : null,
    // (etap „Struga”: `plynie` — dopływ z gardzieli; `wylewka` — wypływ przez wargę wylewki [t/s] i prędkość na niej,
    // `siega` — struga sięga błony, `rura` — kolumna w rurze połączona z wargą)
    struga: { glowa: r1(LS[LIN_STAN.jetHead]), ogon: r1(LS[LIN_STAN.jetTail]), Q: r1(LS[LIN_STAN.jetQ]), v: r1(LS[LIN_STAN.jetV]), plynie: LS[LIN_STAN.jetOn] > 0, wylewka: +LS[LIN_STAN.lipQ].toFixed(2), vWylewki: r1(LS[LIN_STAN.lipV]), siega: LS[LIN_STAN.landed] > 0, rura: LS[LIN_STAN.pipeOn] > 0 },
    zasobnik: { T: Math.round(LS[LIN_STAN.resT]), L: r1(LS[LIN_STAN.resL]), R: r1(LS[LIN_STAN.resR]), mody: [LS[LIN_STAN.q0], LS[LIN_STAN.q1], LS[LIN_STAN.q2]].map((q) => +q.toFixed(3)), miedz: +LS[LIN_STAN.resX].toFixed(3) },
    chlodnice: +LS[LIN_STAN.chill].toFixed(3), plastry: line.view.ring[1], pakiety: line.view.ring[3], stacjeZywe: linia ? linia.live : 0,
    bilans: au.balance, niezgodnosc: au.mismatch, msKroku: +linTiming.stepMs.toFixed(3), cuts: LS[LIN_STAN.cuts], starts: LS[LIN_STAN.starts], hash: line.hash(),
    // (runda 7) obraz formowania z liczonego stanu: nacisk bram G0–G4, ciepło lica paneli chłodnic w przedziałach x
    bramy: linia ? Array.from(linia.filler.press, (v) => +v.toFixed(3)) : null,
    cieploPaneli: linia ? Array.from(linia.chillHeat, (v) => +v.toFixed(3)) : null,
    walcownia: millStats(),
    dzielenie: dividerStats(),
    // (runda 9) stacja odzgorzania: moc, ξ przed / za strefą, zdjęta masa (konto zgorzeliny linii), strumień, płatki w ssawach
    odzgorzanie: { wlaczona: LS[LIN_STAN.odzOn] > 0, moc: +LS[LIN_STAN.odzU].toFixed(3), xiPrzed: +LS[LIN_STAN.odzXiIn].toFixed(4), xiZa: +LS[LIN_STAN.odzXiOut].toFixed(5), zdjetoT: +t.zgorzelina.toFixed(4), strumienKgS: +(LS[LIN_STAN.odzRate] * 1000).toFixed(2), czastek: scaleDebris ? scaleDebris.counts[4] : 0, wSsawach: scaleDebris ? scaleDebris.counts[3] : 0 }
  };
}
/** Dzielenie: nóż, arkusze w ruchu (lot, grzebień), kasety, konta, bilans masy i pędu. */
function dividerStats() {
  if (!divider) return null;
  const V = divider.view;
  const NZ = V.noz;
  const r1 = (v) => +(+v).toFixed(1);
  const r2 = (v) => +(+v).toFixed(2);
  const au = divider.audit();
  const t = divider.tons();
  const B = V.bodies;
  const KS = V.kas;
  let lot = 0; let grz = 0; let przetop = 0; let wej = 0;
  const arkusze = [];
  for (let i = 0; i < ARK_CAP; i++) {
    const o = i * ARK_N;
    const st = B[o + ARK.st];
    if (st === ARK_ST.WOLNY) continue;
    if (st === ARK_ST.LOT) { lot++; if (B[o + ARK.mst] === MARSZ.CZEKA && B[o + ARK.th] > 0) wej++; } else if (st === ARK_ST.GRZEBIEN) grz++; else if (st === ARK_ST.PRZETOP) przetop++;
    if (st === ARK_ST.LOT || st === ARK_ST.GRZEBIEN || st === ARK_ST.PRZETOP) arkusze.push({ nr: B[o + ARK.seq], stan: ARK_ST_NAMES[st], x: r1(B[o + ARK.x]), vx: r1(B[o + ARK.vx]), y: r1(B[o + ARK.y]), z: r1(B[o + ARK.z]), vz: r1(B[o + ARK.vz]), theta: r1(B[o + ARK.th] * 180 / Math.PI), F: r1(B[o + ARK.F]), urz: B[o + ARK.dev], T: Math.round(0.25 * (B[o + ARK.T0] + B[o + ARK.T1] + B[o + ARK.T2] + B[o + ARK.T3])) });
  }
  const kasety = [];
  for (let c = 0; c < KAS_CAP; c++) {
    const o = c * KAS_N;
    if (KS[o + KAS.st] === KAS_ST.WOLNA) continue;
    kasety.push({ id: KS[o + KAS.id], stan: KAS_ST_NAMES[KS[o + KAS.st]], arkuszy: KS[o + KAS.k], przydzielone: KS[o + KAS.asg], dx: r1(KS[o + KAS.dx]), dz: r1(KS[o + KAS.dz]), pokrywa: r2(KS[o + KAS.lid]), t: r2(KS[o + KAS.units] / UNITS_PER_TON) });
  }
  return {
    noz: { stan: NOZ_ST_NAMES[NZ[NOZ.st]], faza: r2(NZ[NOZ.u] - Math.floor(NZ[NOZ.u])), x: r1(NZ[NOZ.x]), v: r1(NZ[NOZ.v]), moc: r2(NZ[NOZ.power]), przemiatanie: r2(NZ[NOZ.sweep]), ciec: NZ[NOZ.cuts], czolo: r1(NZ[NOZ.Lc]), synchr: +NZ[NOZ.dvMax].toFixed(4) },
    arkusz: { dlugosc: +NZ[NOZ.lastLen].toFixed(3), t: +(NZ[NOZ.lastUnits] / UNITS_PER_TON).toFixed(3), rytm: NZ[NOZ.prevCutT] >= 0 ? r2(NZ[NOZ.tCut] - NZ[NOZ.prevCutT]) : null },
    wLocie: lot, wGrzebieniu: grz, doPrzetopu: przetop, wejscieZajete: wej > 0, arkusze, kasety,
    liczniki: { dobre: V.licz[LICZ.dobre], kaset: V.licz[LICZ.kaset], czolo: V.licz[LICZ.czolo], ogon: V.licz[LICZ.ogon], zle: V.licz[LICZ.zle], przepelnienie: V.licz[LICZ.przepelnienie], poTolerancji: V.licz[LICZ.poTolerancji], iskry: V.licz[LICZ.iskry] },
    tony: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, r2(v)])),
    bilans: au.balance, niezgodnosc: au.mismatch, zLinia: au.line, ped: au.ped, przelot: V.licz[LICZ.przelot],
    wyrob: divider.product(), hash: divider.hash()
  };
}
const PRZESLO_NAMES = ['puste', 'czoło', 'pętla', 'koniec'];
/** Walcownia F1–F3: prędkości, walce, pętle, chwyty, wyrób. */
function millStats() {
  if (!millOn) return null;
  const V = mill.view;
  const r2 = (v) => +(+v).toFixed(2);
  const p = mill.product();
  return {
    klatki: WALC.stands.map((s, k) => ({
      id: s.id, grubosc: [s.tIn, s.tOut], vWej: r2(V.vEntry[k]), vWyj: r2(V.vExit[k]), omega: +V.omega[k].toFixed(3), obwod: r2(V.omega[k] * WALC.R),
      m: +V.m[k].toFixed(4), korekta: +V.trim[k].toFixed(4), udar: +V.dip[k].toFixed(4), chwytow: V.bites[k], odChwytu: r2(Math.min(V.biteT[k], 99)), wTasmie: !!(V.covE[k] || V.covX[k]), zgorzelinaT: r2(V.shed[k] / UNITS_PER_TON),
      // (runda 7) grubość wsadu względem nominalnej, szczelina pod obciążeniem (bicie, sprężystość), prędkość napędu
      wsad: +V.rIn[k].toFixed(4), szczelina: +V.gap[k].toFixed(4), naped: r2(V.vDrive[k])
    })),
    przesla: [0, 1].map((j) => ({ tryb: PRZESLO_NAMES[V.mode[j]], luz: r2(V.dL[j]), petla: r2(V.hLoop[j]), petlownik: r2(V.looper[j]), ramieSt: +(V.arm[j] * 180 / Math.PI).toFixed(2), ramieCelSt: +(V.armT[j] * 180 / Math.PI).toFixed(2) })),
    wyrob: { szerokosc: p.szerokosc, grubosc: p.grubosc, grubOsi: r2(p.grubOsi), v: r2(p.v), tNaS: +p.tNaS.toFixed(3), jNaT: r2(p.jNaT) },
    blysk: linia ? r2(linia.flash) : 0, iskry: lineSparks ? lineSparks.count : 0,
    zgorzelina: scaleDebris ? { zywe: scaleDebris.count, urodzone: scaleDebris.counts[0], wDolach: scaleDebris.counts[2] } : null,
    brama: linia ? { lampy: r2(linia.gateLamp), tunel: r2(linia.tunnelLamp) } : null
  };
}
// stan rzeczy ruchomych otoczenia: zawór dyszy (styk wypływu dla etapu „Pasmo”) i dok żużla w hali
const valve = createNozzleValve();
const slagDock = createSlagDock();
let live = !shotMode;
let acc = 0;
let alpha = 1;
const timing = { stepMs: 0, stepMax: 0, steps: 0 };
// rekordy źródeł gazu: po każdym kroku symulacji zabiera je stąd pole gazu (wejście kroku pola składa pakowacz)
const gasBuf = new Float32Array(GAZ_SLOTS * GAZ_STRIDE);
const gasTaken = { units: 0 };
const gasOn = params.get('gaz') !== '0';
const gasPreset = clamp(params.get('gazJakosc') === null ? 1 : Number(params.get('gazJakosc')) | 0, 0, GAZ.presets.length - 1);
const gasIn = createGasInput();
const gasPacker = createGasPacker();
const gasBody = new Float64Array(5);
const gasMach = new Float64Array(6);
const gasFrame = { cam: null, alpha: 1, frame: 0, body: gasBody, on: true, heat: null, mach: gasMach };
const gasHeat = { x: 0, y: 0, size: 1, time: 0, strength: 1 };
let gaz = null;                 // pole gazu (`createWytopGaz`) — null przy `?gaz=0`
let gasProbeLast = null;        // ostatnia sonda przesłony (harness)
let frameNo = 0;

function stepSim(n) {
  for (let k = 0; k < n; k++) {
    const t0 = performance.now();
    sim.step(DT);
    valve.step(DT, S[STAN.impactT], C[LICZNIK.funnel]);
    slagDock.step(DT, C[LICZNIK.slagOut] * sim.split[1] / UNITS_PER_TON);
    if (line) {
      const tl = performance.now();
      linIn[LIN_WEJ.units] = C[LICZNIK.delivered] - linDelivered;
      linDelivered = C[LICZNIK.delivered];
      linIn[LIN_WEJ.tempT] = S[STAN.temp];
      linIn[LIN_WEJ.head] = S[STAN.level] - KOMORA.funnel.throatY;
      linIn[LIN_WEJ.metal] = state.metal;
      linIn[LIN_WEJ.impactT] = S[STAN.impactT];
      linIn[LIN_WEJ.funnelUnits] = C[LICZNIK.funnel];
      linIn[LIN_WEJ.twist] = S[STAN.twist];
      linIn[LIN_WEJ.valve] = valve.state.open;
      line.step(DT, linIn);
      if (scaleDebris) scaleDebris.step(DT, mill, line);
      // iskry szczeliny noża (z liczonej masy szczeliny) — ta sama pula co zgorzelina walcowni
      if (divider) {
        const ns = divider.takeSparks();
        const NZ = divider.view.noz;
        // (iskry kroku wzdłuż odcinka przemiecionego od poprzedniej emisji — nowe przemiatanie ma odwrotny kierunek i
        // zaczyna od brzegu taśmy)
        const zEnd = NZ[NOZ.sparkZ];
        const dK = NZ[NOZ.sparkDir];
        const zFrom = dK === kerfSpark[1] ? kerfSpark[0] : -100 * dK;
        if (ns > 0 && scaleDebris) {
          scaleDebris.emitKerf(NZ[NOZ.sparkX], DZ_PASS_Y, zEnd, NZ[NOZ.vStrip], ns, dK, NZ[NOZ.sparkT], NZ[NOZ.sparkEnd], zFrom, DT);
          kerfSpark[0] = zEnd; kerfSpark[1] = dK;
        }
      }
      lineSparks.step(DT, line);
      linTiming.stepMs += (performance.now() - tl - linTiming.stepMs) * 0.05;
    }
    gasTaken.units += sim.takeGas(gasBuf);
    if (gaz) {
      // wejście kroku pola z tego kroku symulacji; na żywo krok pola idzie w klatce efektów, w trybie zrzutów od razu
      gasPacker.pack(sim, gasBuf, gasIn, metalOf(state.metal));
      if (live) gaz.submit(gasIn); else gaz.stepNow(gasIn);
    }
    const ms = performance.now() - t0;
    timing.stepMs += (ms - timing.stepMs) * 0.05;
    timing.stepMax = Math.max(timing.stepMax * 0.998, ms);
    timing.steps++;
  }
  if (obraz && n > 0) obraz.apply(sim.view);
  if (linia && n > 0) { linia.applySparks(lineSparks.count); if (scaleDebris) linia.applyScale(scaleDebris.count); }
}

function sunChamber() {
  // kierunek ku słońcu w układzie komory (x, y w górę, z) — ten sam co budowle zestawu (azymut ze Słońca gry)
  const az = Math.atan2(-(window.SUN.y - P0.y), window.SUN.x - P0.x);
  const el = SUN_ELEVATION * DEG;
  return [Math.cos(el) * Math.cos(az), Math.sin(el), -Math.cos(el) * Math.sin(az)];
}

// ---------------------------------------------------------------------------
// Widoki
const VIEWS = [
  // (runda 6: kadr gry nad naczyniem i linią formowania — naczynie przy lewym brzegu, linia w prawo, zbiorniki tlenu i dok
  // żużla w hali; dawny kadr komory: `WIDOKI.top1Old`)
  { key: 1, name: 'Z góry', sub: 'kamera gry: naczynie, wylewka, struga w polu, błona wyciskana wędrującym zaciskiem pola, gardziel G0, taśma, stygnięcie, zbiorniki tlenu', top: WIDOKI.top1.slice() },
  { key: 2, name: 'Kupa i kula z ukosa', sub: 'kupa rudy, docisk cewek, topienie, falowanie kuli', cine: { at: [0, -40, 0], az: -0.9, el: 1.02, dist: 940 } },
  { key: 3, name: 'Wlot ziaren', sub: 'brama 0 g, struga i spirala do środka', cine: { at: [-290, 10, 250], az: -0.85, el: 1.05, dist: 640 } },
  { key: 4, name: 'Żużel: czapa i ssawa', sub: 'wyspy spływają na biegun, ssawa ściąga czapę nitką', cine: { at: [84, 286, 0], az: -1.25, el: 0.42, dist: 700 } },
  { key: 5, name: 'Zrzut', sub: 'wyświetlacz, spadek kuli, masa w leju, gardziel', cine: { at: [0, -430, 0], az: -0.72, el: 1.2, dist: 1180 } },
  { key: 6, name: 'Odbieralnik żużla', sub: 'żużel z rurociągu stygnie w ciemne granulki', cine: { at: [366, 246, 280], az: 3.75, el: 0.74, dist: 370 } },
  { key: 7, name: 'Odciąg i zbiorniki', sub: 'rura tlenu schodzi z kołnierza do hali, tlen płynie do zbiorników (listwy napełnienia)', cine: { ...WIDOKI.w7, at: WIDOKI.w7.at.slice() } },
  { key: 8, name: 'Wylewka i błona', sub: 'rura spod naczynia, wylewka z zaworem, struga w pierścieniach pola, błona, zacisk pola (bramki), gardziel G0', cine: { ...WIDOKI.w8, at: WIDOKI.w8.at.slice() } },
  { key: 9, name: 'Walcowanie', sub: 'klatki F1–F3: taśma 30 → 20 → 13 → 9 j. przyspiesza, pętle między klatkami, iskry zgorzeliny przy chwycie, brama „DO ZWIJARKI”', cine: { ...WIDOKI.w9, at: WIDOKI.w9.at.slice() } },
  { key: 0, name: 'Z boku — całość', sub: 'naczynie-lejek nad halą, rura spustowa, wylewka, błona, linia do noża i gniazd', cine: { ...WIDOKI.w0, at: WIDOKI.w0.at.slice() } },
  // (runda 9) DZIELENIE z ukosa od strony walcowni: nóż, wyrzut i chwyt listwą pola, przechył na sztorc, grzebień, kasety
  { key: 'D', name: 'Dzielenie z ukosa', sub: 'nóż polowy tnie arkusze 640 j. w locie; arkusz wyrzucony leci, listwa pola łapie krawędź, hamuje i stawia go na sztorc; grzebień niesie go do kasety (8 arkuszy), kaseta z pokrywą pola odjeżdża przez bramę', cine: { ...WIDOKI_DZ.D, at: WIDOKI_DZ.D.at.slice() } }
];
// kino: kamera wokół punktu komory; `az` — kąt od +x ku +z (skąd patrzy kamera), `el` — nad poziomem
const cine = { cam: null, persp: new THREE.PerspectiveCamera(42, 1, 5, 400000), target: new THREE.Vector3(), at: [0, 0, 0], az: 1, el: 0.7, dist: 700 };
cine.persp.up.set(0, 0, 1);

function frameTop(x0, z0, x1, z1) {
  const panel = shotMode ? 0 : 284;
  const zoom = Math.min((Math.max(W, 640) - panel) / (x1 - x0), Math.max(H, 360) / (z1 - z0));
  state.cam.zoom = zoom;
  state.cam.roll = 0;
  state.cam.x = P0.x + (x0 + x1) / 2 + panel / 2 / zoom;
  state.cam.y = P0.y + (z0 + z1) / 2;
}
function applyView(key) {
  const v = VIEWS.find((q) => q.key === key) || VIEWS[0];
  state.view = v.key;
  if (v.top) {
    state.mode = 'top';
    frameTop(...v.top);
  } else {
    state.mode = 'cine';
    cine.az = v.cine.az;
    cine.el = v.cine.el;
    cine.dist = v.cine.dist;
    cine.at = v.cine.at.slice();
  }
  for (const b of viewButtons) b.classList.toggle('on', b.dataset.view === String(v.key));
}
function cineCamera() {
  const p = cine.persp;
  const ce = Math.cos(cine.el);
  // punkt komory (x, y, z) → scena: (x, −z, y − deckY); pod pokładem wysokości 1:1
  cine.target.set(P0.x + cine.at[0], -(P0.y + cine.at[2]), cine.at[1] - KOMORA.deckY);
  p.aspect = W / Math.max(1, H);
  p.near = Math.max(5, cine.dist * 0.03);
  p.updateProjectionMatrix();
  p.position.set(cine.target.x + Math.cos(cine.az) * ce * cine.dist, cine.target.y - Math.sin(cine.az) * ce * cine.dist, cine.target.z + Math.sin(cine.el) * cine.dist);
  p.lookAt(cine.target);
  p.updateMatrixWorld();
  if (!cine.cam) cine.cam = { mode: 'free3d', position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 42, near: 5, far: 400000, zoom: 1 };
  cine.cam.near = p.near;
  cine.cam.position.copy(p.position);
  cine.cam.quaternion.copy(p.quaternion);
  cine.cam.x = p.position.x;
  cine.cam.y = -p.position.y;
  return cine.cam;
}

// ---------------------------------------------------------------------------
// UI
const viewButtons = VIEWS.map((v) => {
  const b = document.createElement('button');
  b.dataset.view = String(v.key);
  b.innerHTML = `${v.key} · ${v.name}<small>${v.sub}</small>`;
  b.addEventListener('click', () => { applyView(v.key); canvas2d.focus(); });
  $('views').appendChild(b);
  return b;
});
const css = (c) => `rgb(${c.map((q) => Math.round(255 * Math.pow(clamp(q, 0, 1), 1 / 2.2))).join(',')})`;
const metalButtons = METALE.filter((m) => m.gotowy).map((m) => {
  const b = document.createElement('button');
  b.className = 'metal';
  b.innerHTML = `<i style="background:${css(m.ramp[2])}"></i>${m.name.toLowerCase()}`;
  b.title = `${m.name} z: ${m.oreName}`;
  b.addEventListener('click', () => { setMetal(m.index); canvas2d.focus(); });
  $('metals').appendChild(b);
  return b;
});
const SPEEDS = [['pauza', 0], ['×¼', 0.25], ['×1', 1], ['×2', 2]];
const speedButtons = SPEEDS.map(([label, s]) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => { setSpeed(s); canvas2d.focus(); });
  $('speeds').appendChild(b);
  return b;
});
const phaseBars = PHASE_NAMES.map((name) => {
  const i = document.createElement('i');
  i.title = name;
  $('phase').appendChild(i);
  return i;
});
// kolejność faz na pasku: pusta, zbieranie, docisk, topienie, dokarmianie, rafinacja, odsuw, zrzut
function setSpeed(s) {
  state.paused = s === 0;
  if (s > 0) state.speed = s;
  syncUi();
}
function setMetal(i) {
  state.metal = clamp(i | 0, 0, 1);
  if (obraz) obraz.setMetal(metalOf(state.metal));
  if (gaz) gaz.setMetal(metalOf(state.metal));
  syncUi();
}
function syncUi() {
  speedButtons.forEach((b, i) => b.classList.toggle('on', state.paused ? SPEEDS[i][1] === 0 : SPEEDS[i][1] === state.speed));
  metalButtons.forEach((b, i) => b.classList.toggle('on', i === state.metal));
}
const tons = (u) => (u / UNITS_PER_TON).toFixed(1).padStart(6);
/** Zbiorniki tlenu w panelu: napełnienie w procentach, ▸ — napełniany, ▾ — oddaje tlen do sieci ringu. */
function tankBars() {
  const d = S[STAN.tankDrain];
  return [S[STAN.tank0], S[STAN.tank1], S[STAN.tank2]].map((f, k) => {
    const mark = d >= 0 && Math.floor(d) === k ? '▾' : (S[STAN.tankFill] | 0) === k ? '▸' : ' ';
    return `${mark}${String(Math.round(f * 100)).padStart(3)}%`;
  }).join('');
}
function updateHud() {
  if (shotMode) return;
  const p = S[STAN.phase];
  phaseBars.forEach((b, i) => b.classList.toggle('on', i === p));
  const a = sim.audit();
  const m = metalOf(state.metal);
  const tt = sim.tons();
  $('counters').innerHTML = [
    `<b>${m.name}</b>  <span class="dim">${PHASE_NAMES[p]} · obieg ${S[STAN.cycle]}</span>`,
    `grawitacja <b>${S[STAN.grav] ? 'WŁĄCZONA' : '0 g'}</b>  <span class="dim">wyświetlacz: ${DSP_NAMES[S[STAN.dsp]]}</span>`,
    `kupa rudy  <b>${(C[LICZNIK.heap] / 128).toFixed(1).padStart(6)}</b> t  <span class="dim">${C[LICZNIK.heap]} ziaren</span>`,
    `kula       <b>${(sim.tons().kula).toFixed(1).padStart(6)}</b> t  <span class="dim">r ${(C[LICZNIK.funnel] > 0 ? 0 : S[STAN.radius]).toFixed(0)} j.${S[STAN.clean] > 0.5 ? ' · CZYSTA' : ''}</span>`,
    `temperatura  <b>${(S[STAN.temp] * 100).toFixed(0).padStart(3)}</b> %  <span class="dim">grzanie ${(S[STAN.heat] * 100).toFixed(0)} %</span>`,
    `taśma      <b>${(C[LICZNIK.belt] / 128).toFixed(1).padStart(6)}</b> t`,
    `w locie    <b>${(C[LICZNIK.flight] / 128).toFixed(1).padStart(6)}</b> t  <span class="dim">${C[LICZNIK.flight]} ziaren</span>`,
    `żużel na kuli <b>${tt.zuzelNaKuli.toFixed(1).padStart(5)}</b> t  <span class="dim">wysp ${sim.view.nKry} · czapa ${(S[STAN.capMass] * sim.split[1] / UNITS_PER_TON).toFixed(1)} t</span>`,
    `ssawa      <b>${['postój', 'dojazd', 'ściąga', 'powrót'][S[STAN.suck]].padStart(6)}</b>  <span class="dim">w rurze ${tt.nitka.toFixed(1)} t</span>`,
    `odbieralnik <b>${tt.odbieralnik.toFixed(1).padStart(5)}</b> t  <span class="dim">wywiezione ${tt.wywiezione.toFixed(1)} t</span>`,
    `gaz komory <b>${S[STAN.gasAirT].toFixed(1).padStart(6)}</b> t  <span class="dim">kąpiel ${S[STAN.gasBathT].toFixed(1)} · ${S[STAN.wentyl] < 0 ? 'ssie pierścień' : `odciąg ${S[STAN.gasFlow].toFixed(1)} t/s`}</span>`,
    `tlen  <b>${tankBars()}</b>  <span class="dim">sieć ${S[STAN.gasOutT].toFixed(0)} t</span>`,
    `<span class="dim">pole gazu: ${gaz ? `${gaz.preset.nazwa} ${gaz.preset.nx}×${gaz.preset.ny}×${gaz.preset.nz}${gaz.asleep ? ' · śpi' : ''}` : 'wyłączone (?gaz=0)'}</span>`,
    `zawór dyszy <b>${valve.state.open > 0.5 ? 'OTWARTA' : 'zamknięta'}</b>  <span class="dim">dok żużla ${slagDock.state.level.toFixed(1)} t · do sieci ${slagDock.state.outT.toFixed(0)} t</span>`,
    `lej        <b>${tons(C[LICZNIK.funnel])}</b> t  <span class="dim">oddane ${tons(C[LICZNIK.delivered]).trim()} t${S[STAN.impactT] >= 0 && C[LICZNIK.funnel] > 0 ? ` · kołysanie ${S[STAN.slosh].toFixed(0)} j./s` : ''}</span>`,
    `<span class="dim">bilans mas ${a.balance === 0 ? '0' : a.balance}   obieg ${S[STAN.cycleTime].toFixed(0)} s</span>`,
    `<span class="dim">krok ${timing.stepMs.toFixed(2)} ms (szczyt ${timing.stepMax.toFixed(1)})  ${state.fps.toFixed(0)} kl/s  rys. ${lastInfo.calls}</span>`
  ].join('\n');
  if (line) {
    const q = lineStats();
    $('linCounters').innerHTML = [
      `tryb <b>${q.tryb.toUpperCase()}</b>  <span class="dim">${q.wylot ? 'wylot G0 otwarty' : 'wylot zamknięty'}</span>`,
      `rura       <b>${q.tony.rura.toFixed(1).padStart(6)}</b> t  <span class="dim">zawór wylewki ${q.zawor > 0.5 ? 'OTWARTY' : 'zamknięty'}</span>`,
      `struga     <b>${q.tony.struga.toFixed(1).padStart(6)}</b> t  <span class="dim">${q.struga.plynie ? `${q.struga.Q.toFixed(0)} t/s · ${q.struga.v.toFixed(0)} j./s` : 'bez spływu'}</span>`,
      `błona      <b>${q.tony.blona.toFixed(1).padStart(6)}</b> t  <span class="dim">${q.zasobnik.T} K · ${q.blona.L.toFixed(0)} × ${(2 * q.blona.W).toFixed(0)} × ${(2 * q.blona.H).toFixed(0)} j.</span>`,
      `zacisk pola <b>${q.blona.zacisk.x.toFixed(0).padStart(5)}</b> j.  <span class="dim">${q.blona.zacisk.otwiera ? 'otwiera rękaw pod strugę' : q.blona.zacisk.posuw > 0.5 ? `wyciska ${q.blona.zacisk.posuw.toFixed(0)} j./s` : q.blona.zacisk.posuw < -0.5 ? `cofa się ${(-q.blona.zacisk.posuw).toFixed(0)} j./s` : 'stoi'} · ścisk ${(q.blona.scisk * 100).toFixed(0)} % · napięcie ${(q.blona.napiecie * 100).toFixed(0)} %</span>`,
      `pasmo      <b>${q.tony.pasmo.toFixed(1).padStart(6)}</b> t  <span class="dim">${q.Q.toFixed(2)} t/s · ${q.v.toFixed(0)} j./s</span>`,
      `front krzepnięcia x <b>${q.front === null ? '—' : q.front.toFixed(0)}</b>  <span class="dim">(G0 ${G0X}, F1 ${LINIA.stands[0].x})</span>`,
      ...(q.walcownia ? [
        `walcownia  <span class="dim">grubość 30 → 20 → 13 → 9 j.</span>`,
        `  ${q.walcownia.klatki.map((k) => `${k.id} <b>${k.vWyj.toFixed(0)}</b>`).join(' · ')} <span class="dim">j./s</span>`,
        `  pętle <b>${q.walcownia.przesla.map((p) => `${p.petla.toFixed(0)}`).join(' / ')}</b> j. <span class="dim">luz ${q.walcownia.przesla.map((p) => p.luz.toFixed(1)).join(' / ')} j.</span>`,
        `wyrób      <b>${q.walcownia.wyrob.szerokosc} × ${q.walcownia.wyrob.grubosc}</b> j.  <span class="dim">${q.walcownia.wyrob.v.toFixed(0)} j./s · ${q.walcownia.wyrob.tNaS.toFixed(2)} t/s</span>`
      ] : []),
      ...(q.dzielenie ? [
        `dzielenie <b>${q.dzielenie.noz.stan.toUpperCase()}</b>  <span class="dim">cięć ${q.dzielenie.noz.ciec} · ostatni arkusz ${q.dzielenie.arkusz.dlugosc.toFixed(1)} j. / ${q.dzielenie.arkusz.t.toFixed(2)} t${q.dzielenie.arkusz.rytm ? ` · co ${q.dzielenie.arkusz.rytm.toFixed(2)} s` : ''}</span>`,
        `  lot <b>${q.dzielenie.wLocie}</b> · grzebień <b>${q.dzielenie.wGrzebieniu}</b> · do przetopu ${q.dzielenie.doPrzetopu}${q.dzielenie.wejscieZajete ? ' · <b>WEJŚCIE ZAJĘTE</b>' : ''}`,
        `  kasety ${q.dzielenie.kasety.map((k) => `<b>${k.arkuszy}/8</b> ${k.stan}`).join(' · ')}`,
        `  <span class="dim">kaset odebranych <b>${q.dzielenie.liczniki.kaset}</b> · odebrane ${q.dzielenie.tony.odebrane.toFixed(0)} t · przetop ${q.dzielenie.tony.przetop.toFixed(1)} t</span>`,
        `  <span class="dim">dobre ${q.dzielenie.liczniki.dobre} · czoło ${q.dzielenie.liczniki.czolo} · ogon ${q.dzielenie.liczniki.ogon} · metal mieszany ${q.dzielenie.liczniki.zle} · przepełnienie ${q.dzielenie.liczniki.przepelnienie}</span>`,
        `<span class="dim">bilans dzielenia ${q.dzielenie.bilans === 0 && q.dzielenie.niezgodnosc === 0 && q.dzielenie.zLinia === 0 ? '0' : `${q.dzielenie.bilans} / ${q.dzielenie.zLinia}`} · bilans linii ${q.bilans === 0 && q.niezgodnosc === 0 ? '0' : q.bilans} · krok ${q.msKroku.toFixed(2)} ms</span>`
      ] : [`<span class="dim">koniec pasma ${q.tony.wyszlo.toFixed(0)} t · bilans ${q.bilans === 0 && q.niezgodnosc === 0 ? '0' : q.bilans} · krok ${q.msKroku.toFixed(2)} ms</span>`])
    ].join('\n');
  }
}

let dragging = false;
let lastX = 0;
let lastY = 0;
canvas2d.addEventListener('contextmenu', (e) => e.preventDefault());
canvas2d.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas2d.setPointerCapture(e.pointerId); canvas2d.focus(); });
canvas2d.addEventListener('pointerup', () => { dragging = false; });
canvas2d.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  if (state.mode === 'cine') {
    cine.az += dx * 0.005;
    cine.el = clamp(cine.el + dy * 0.004, 0.08, 1.5);
    return;
  }
  state.cam.x -= dx / state.cam.zoom;
  state.cam.y -= dy / state.cam.zoom;
});
canvas2d.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (state.mode === 'cine') {
    cine.dist = clamp(cine.dist * Math.exp(e.deltaY * 0.001), 150, 6000);
    return;
  }
  const k = Math.exp(-e.deltaY * 0.0012);
  const z0 = state.cam.zoom;
  const z1 = clamp(z0 * k, 0.12, 5);
  const sx = e.clientX - W / 2;
  const sy = e.clientY - H / 2;
  state.cam.x += sx / z0 - sx / z1;
  state.cam.y += sy / z0 - sy / z1;
  state.cam.zoom = z1;
}, { passive: false });
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (/^Digit[0-9]$/.test(e.code)) applyView(Number(e.code.slice(5)));
  else if (e.code === 'KeyD') applyView('D');
  else if (e.code === 'Space') { setSpeed(state.paused ? state.speed : 0); e.preventDefault(); }
  else if (e.code === 'KeyK' && line) line.drain();
});

// ---------------------------------------------------------------------------
// Klatka
const cullInfo = { x: 0, y: 0, drawHalfW: 0, drawHalfH: 0, halfW: 0, halfH: 0 };
const lastInfo = { calls: 0, triangles: 0 };
const frameArgs = { alpha: 1, cam: [0, 2000, 0], pxK: 1, ppuBall: 1, minPx: 1.5, viewW: 1, viewH: 1 };
const NO_ENTITIES = [];

function render(realDt) {
  if (live && !state.paused) {
    acc += realDt * state.speed;
    let n = Math.floor(acc / DT);
    if (n > 8) { n = 8; acc = n * DT; }      // zaległość (karta była w tle)
    acc -= n * DT;
    if (n > 0) stepSim(n);
    alpha = acc / DT;
  } else if (!live) alpha = 1;
  const cam = state.mode === 'cine' ? cineCamera() : state.cam;
  const simDt = live && !state.paused ? realDt * state.speed : 0;
  if (deck) {
    deck.setSun(SUN_OPTS);
    // czas zestawu = zegar generatora 0 g (staje razem z szewronami wyświetlacza)
    deck.tick(Math.max(0, S[STAN.spin] * 0.5 - deck.time), TICK);
    deck._setChan(0, S[STAN.beltRun]);
    deck._setChan(1, S[STAN.coilGlow]);
    deck._setChan(2, S[STAN.grav]);
    deck._setChan(3, S[STAN.dsp] === DSP.RUN ? 1 : 0);
  }
  const fov = state.mode === 'cine' ? 42 : (Core3D.cameraPersp?.fov || 35);
  const pxScale = Core3D.pxScale || 1;
  const pxK = (H * pxScale * 0.5) / Math.tan(fov * 0.5 * DEG);
  if (obraz) {
    const fa = frameArgs;
    fa.alpha = alpha;
    fa.pxK = pxK;
    fa.minPx = 1.5 * pxScale;
    fa.viewW = W * pxScale;
    fa.viewH = H * pxScale;
    if (state.mode === 'cine') {
      const p = cine.persp.position;
      fa.cam[0] = p.x - P0.x;
      fa.cam[1] = p.z + KOMORA.deckY;
      fa.cam[2] = -p.y - P0.y;
    } else {
      // kamera z góry stoi nad punktem kadru na wysokości (h / 2) / tg(fov / 2) / zoom nad płaszczyzną gry
      fa.cam[0] = state.cam.x - P0.x;
      fa.cam[1] = (H * 0.5) / Math.tan(fov * 0.5 * DEG) / state.cam.zoom + KOMORA.deckY;
      fa.cam[2] = state.cam.y - P0.y;
    }
    const dist = Math.sqrt(fa.cam[0] * fa.cam[0] + fa.cam[1] * fa.cam[1] + fa.cam[2] * fa.cam[2]);
    fa.ppuBall = pxK / Math.max(1, dist);
    obraz.frame(fa);
    if (linia) linia.frame(line, mill, alpha, DT, realDt > 0 ? realDt : 0);
    // (po linii: kanały pola 32–47, grupy ruchome i światło [14] przy cięciu — linia zeruje blok świateł i kanały)
    if (dz) dz.frame(divider, line, alpha, DT, realDt > 0 ? realDt : 0, linia ? linia.flash : 0);
    if (zl) zl.frame(line ? LiniaObraz.valveAngleOf(line) : valve.angle(), slagDock.fill(), slagDock.state.heat, linia ? linia.spoutHeat : 0, linia ? linia.pipeHeat : 0);
    if (gaz) {
      // obraz gazu: kamera i bryła tej klatki (stan wymieszany jak w obrazie komory), przenikanie dwóch stanów pola
      // ułamkiem kroku; tarcza drgania powietrza tylko w widoku z góry (kamera gry) — z paralaksą studni pod pokładem
      gasFrame.cam = fa.cam;
      gasFrame.alpha = alpha;
      gasFrame.frame = frameNo++;
      gasBodyOf(obraz.S, gasBody);
      // zasłony gazu: maszyneria w studni (segmenty cewek, wysięgniki, wózek ssawy) z tej klatki
      gasMach[0] = obraz.S[STAN.mach]; gasMach[1] = obraz.S[STAN.machY];
      gasMach[2] = obraz.S[STAN.cageX]; gasMach[3] = obraz.S[STAN.cageY]; gasMach[4] = obraz.S[STAN.cageZ];
      gasMach[5] = obraz.S[STAN.headX];
      gasFrame.heat = null;
      if (state.mode === 'top' && heatOn) {
        const hc = fa.cam[1] - KOMORA.deckY;
        const k = hc / (hc + KOMORA.deckY - 150);      // odniesienie: gorący gaz ok. 150 j. nad środkiem pola
        gasHeat.x = state.cam.x + (P0.x - state.cam.x) * k;
        gasHeat.y = -(state.cam.y + (P0.y - state.cam.y) * k);
        gasHeat.size = GAZ.size * k;
        gasHeat.time = obraz.S[STAN.time];
        gasFrame.heat = gasHeat;
      }
      gaz.frame(gasFrame);
    }
    // drganie gorąca wokół kuli (potok gry; w kamerze swobodnej Core3D zniekształcenia wyłącza)
    if (state.mode === 'top' && heatOn && obraz.ball.visible && !(obraz.S[STAN.impactT] >= 0)) {
      const field = Core3D.fxDistortion ? Core3D.fxDistortion() : null;
      if (field && field.heat) {
        const hc = fa.cam[1] - KOMORA.deckY;
        const k = hc / (hc + KOMORA.deckY);      // kula `deckY` pod płaszczyzną gry: paralaksa ku środkowi kadru
        const R = obraz.S[STAN.radius];
        const T = obraz.S[STAN.temp];
        field.heat(state.cam.x + (P0.x - state.cam.x) * k, state.cam.y + (P0.y - state.cam.y) * k, R * 1.55 * k, 2.2 * clamp(T - 0.3, 0, 1));
      }
    }
    // drganie gorącego powietrza nad linią (z góry): zasobnik i ciekła część pasma; paralaksa — linia 1 460 j. pod płaszczyzną
    if (line && linia && state.mode === 'top' && heatOn) {
      const field = Core3D.fxDistortion ? Core3D.fxDistortion() : null;
      if (field && field.heat) {
        const hc = fa.cam[1] - KOMORA.deckY;
        const k = hc / (hc + KOMORA.deckY - HALA.passY);
        const LS = line.stan;
        const V = LS[LIN_STAN.resV] / UNITS_PER_TON;
        // drganie tylko tam, gdzie linię widać: rzut punktu osi pasma (głębiej niż płaszczyzna — bliżej środka kadru) poza
        // obrysem kołnierza naczynia (+60 j.); pod kołnierzem zniekształcałoby wnętrze komory (błona leży poza obrysem)
        const cxl = state.cam.x - P0.x;
        const zpl = (state.cam.y - P0.y) * (1 - k);
        const Rf = NACZYNIE.flange.rOut + 60;
        const xVis = Math.abs(zpl) >= Rf ? -1e9 : cxl + (Math.sqrt(Rf * Rf - zpl * zpl) - cxl) / k;
        if (V > 1) {
          const L = LS[LIN_STAN.resL];
          const xb = Math.max(xVis, LS[LIN_STAN.memXb]);
          const half = (G0X - xb) * 0.5;
          if (half > 30) {
            const x = xb + half;
            field.heat(state.cam.x + (P0.x + x - state.cam.x) * k, state.cam.y + (P0.y - state.cam.y) * k, Math.min(half, LS[LIN_STAN.memW] * 1.1) * 1.1 * k, 1.6, 1, 0, Math.max(1, half / Math.max(LS[LIN_STAN.memW], 30)));
          }
        }
        // ciekła część pasma: od wylotu G0 do frontu krzepnięcia (wzdłuż osi, rozciągnięte)
        const fs = LS[LIN_STAN.frontSolid];
        if (LS[LIN_STAN.attached] > 0 && fs > 0) {
          const x0 = Math.max(G0X, xVis);
          const len = fs - PATH.xOff - x0;
          if (len > 40) {
            const x = x0 + len * 0.5;
            field.heat(state.cam.x + (P0.x + x - state.cam.x) * k, state.cam.y + (P0.y - state.cam.y) * k, len * 0.5 * k, 1.1, 1, 0, 2.6);
          }
        }
      }
    }
  }
  const zoom = state.mode === 'cine' ? 1 : cam.zoom;
  cullInfo.x = cam.x;
  cullInfo.y = cam.y;
  cullInfo.drawHalfW = W * 0.5 / zoom + 600;
  cullInfo.drawHalfH = H * 0.5 / zoom + 600;
  cullInfo.halfW = cullInfo.drawHalfW * 3;
  cullInfo.halfH = cullInfo.drawHalfH * 3;
  SimClock.advance(realDt);
  Fx3D.update(simDt);
  updateHexShips3D(cam, NO_ENTITIES, cullInfo);
  drawHexShips3D(ctx2d, W, H);
  const r = Core3D.lastFrameRenderInfo?.total || Core3D.renderer?.info?.render || null;
  lastInfo.calls = r ? r.calls || 0 : 0;
  lastInfo.triangles = r ? r.triangles || 0 : 0;
}
let heatOn = params.get('drganie') !== '0';

let lastMs = performance.now();
let hudAt = 0;
function loop(now) {
  const realDt = Math.min(0.1, Math.max(0, (now - lastMs) / 1000));
  lastMs = now;
  state.fps = state.fps * 0.95 + (realDt > 0 ? 1 / realDt : 60) * 0.05;
  try { render(realDt); } catch (err) { reportError(err.stack || String(err)); return; }
  if (now - hudAt > 150) { hudAt = now; updateHud(); }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Pipeline'y: licznik tworzonych synchronicznie (rysunek bez rozgrzewki) — ma być 0 po starcie
const pipes = { list: [], atReady: 0 };
function hookPipelines() {
  const pu = Core3D.renderer?.backend?.pipelineUtils;
  if (!pu || pu.__wytopHook) return;
  pu.__wytopHook = true;
  const orig = pu.createRenderPipeline;
  pu.createRenderPipeline = function (ro, promises) {
    if (pipes.list.length < 2048) pipes.list.push({ sync: !promises, name: `${ro?.material?.name || ro?.material?.type || '?'} @ ${ro?.object?.name || ro?.object?.type || '?'}` });
    return orig.call(this, ro, promises);
  };
}

// ---------------------------------------------------------------------------
// API zrzutów (scripts/webgpu/huta-wytop-demo.mjs)
const nextTask = () => new Promise((ok) => setTimeout(ok, 0));
window.__wytop = {
  ready: false,
  get errors() { return errors.slice(); },
  view(i) { applyView(i); return VIEWS.find((q) => q.key === state.view)?.name; },
  /** Kamera z góry: środek (x, z) komory i zoom [px / j.]. */
  camera(x, z, zoom) { state.mode = 'top'; state.cam.x = P0.x + x; state.cam.y = P0.y + z; state.cam.zoom = zoom; state.cam.roll = 0; },
  /** Kamera z ukosa wokół punktu komory (x, y, z): az — skąd patrzy (od +x ku +z), el — nad poziomem, odległość. */
  cine(az, el, dist, x, y, z) {
    state.mode = 'cine';
    if (Number.isFinite(az)) cine.az = az;
    if (Number.isFinite(el)) cine.el = el;
    if (Number.isFinite(dist)) cine.dist = dist;
    if (Number.isFinite(x)) cine.at = [x, y, z];
  },
  metal(i) { setMetal(i); return metalOf(state.metal).id; },
  speed(k) { setSpeed(k); },
  /** `seconds` symulacji bez czekania na zegar ściany (tryb zrzutów). Obietnica: { steps, ms, stepMs, stepMax }. */
  async simulate(seconds) {
    live = false;
    const n = Math.max(0, Math.round(seconds / DT));
    const t0 = performance.now();
    let max = 0;
    for (let done = 0; done < n;) {
      const m = Math.min(gaz ? 20 : 240, n - done);       // z polem gazu krótsze porcje (każdy krok to dispatche GPU; odczyt masy pola dla regulatora przychodzi między porcjami)
      const a = performance.now();
      stepSim(m);
      max = Math.max(max, (performance.now() - a) / m);
      done += m;
      if (done < n) await nextTask();
    }
    const ms = performance.now() - t0;
    return { steps: n, ms, stepMs: n ? ms / n : 0, stepMax: timing.stepMax, chunkMax: max };
  },
  /** Krokuje do fazy `name` (pusta, zbieranie, docisk, topienie, dokarmianie, rafinacja, odsuw, zrzut) i `t` sekund w niej (najwyżej 160 s). */
  async seek(name, t = 0) {
    live = false;
    const want = PHASE_NAMES.indexOf(name);
    let guard = 0;
    // najpierw wyjście z bieżącego wystąpienia fazy, jeśli jest już za chwilą `t`
    const chunk = gaz ? 20 : 240;
    while (guard < 160 * 60 && S[STAN.phase] === want && S[STAN.phaseT] > t + 1e-6) { stepSim(1); guard++; if (guard % chunk === 0) await nextTask(); }
    while (guard < 160 * 60 && !(S[STAN.phase] === want && S[STAN.phaseT] >= t - 1e-6)) { stepSim(1); guard++; if (guard % chunk === 0) await nextTask(); }
    return { phase: PHASE_NAMES[S[STAN.phase]], phaseT: S[STAN.phaseT], time: S[STAN.time], steps: guard };
  },
  /** Powrót do kroków w czasie rzeczywistym (po `simulate`). */
  resume() { live = true; acc = 0; },
  /** `n` klatek obrazu bez kroku symulacji (każda w osobnym zadaniu JS). */
  async renderFrames(n = 1, dt = 1 / 60) {
    for (let i = 0; i < n; i++) {
      render(dt);
      if (i + 1 < n) await nextTask();
    }
    updateHud();
    return { ...lastInfo };
  },
  snapshot(type = 'image/jpeg', quality = 0.9) { render(0); return canvas2d.toDataURL(type, quality); },
  /** Strojenie wyglądu: { t1: [a, b, c, d], … } — wektory uniformów `t1…t6`; `cover` — stały mnożnik jasności kuli. */
  tune(o) {
    if (!obraz) return null;
    for (const k of ['t1', 't2', 't3', 't4', 't5', 't6']) if (o[k]) obraz.U[k].value.fromArray(o[k]);
    if ('cover' in o) obraz.coverK = o.cover;
    if ('drganie' in o) heatOn = !!o.drganie;
    return { t1: obraz.U.t1.value.toArray(), t2: obraz.U.t2.value.toArray(), t3: obraz.U.t3.value.toArray(), t4: obraz.U.t4.value.toArray() };
  },
  /** Strojenie wyglądu gazu (`GAZ_LOOK`: scatter, lightGain, dispGain, ambient, shadowK, knee, heatGrad, heatWave…). */
  gasTune(o) {
    if (!gaz) return null;
    if (o) { gaz.setLook(o); gaz.relightNow(); }
    return { ...gaz.grid.look };
  },
  /**
   * SONDA pola gazu (kryteria czytelności K1–K4): przesłona pionowa w strefach (tarcza kuli, pas wyświetlacza, tarcza
   * leja, pierścień, okapy) i masy pola. Odczyt z GPU — tylko harness.
   */
  async gasProbe(map = false) {
    if (!gaz) return null;
    // tarcza bryły (K1): kula, a przed stopieniem — obrys kupy rudy (to ją widać z góry w środku kadru)
    gasBodyOf(S, gasBody);
    const R = gasBody[3];
    // `jadro`: przy kupie — ciekłe jądro w topionej kupie; przy kuli (runda 6, zasysanie gazu) — ŚRODEK tarczy kuli
    // (ρ < 0,7 R: K1 obowiązuje tu bez zmian, gaz wolno lekko zajść tylko na brzeg)
    const heapOn = S[STAN.heapN] > 0 && S[STAN.impactT] < 0;
    gasProbeLast = await gaz.probe({ R, offX: S[STAN.offX], offZ: S[STAN.offZ], map, core: heapOn ? S[STAN.radius] : 0.7 * R });
    if (gasProbeLast) gasProbeLast.symulacja = { komoraT: S[STAN.gasAirT], zrodlaTs: S[STAN.gasEmit], wentyl: S[STAN.wentyl], grav: S[STAN.grav], promien: R };
    return gasProbeLast;
  },
  /**
   * Jasność tarczy w kadrze widoku z góry (kryterium K5): koło o promieniu `r` j. wokół punktu komory (x, z) na
   * wysokości `y` — średnia i odchylenie standardowe luminancji pikseli kanwy (0…1), po narysowaniu klatki.
   */
  diskStats(x = 0, z = 0, y = 0, r = 200) {
    if (state.mode !== 'top') return null;
    render(0);
    const fov = Core3D.cameraPersp?.fov || 35;
    const hc = (H * 0.5) / Math.tan(fov * 0.5 * DEG) / state.cam.zoom;
    const k = hc / (hc + KOMORA.deckY - y);
    const sx = W / 2 + (P0.x + x - state.cam.x) * k * state.cam.zoom;
    const sy = H / 2 + (P0.y + z - state.cam.y) * k * state.cam.zoom;
    const rp = r * k * state.cam.zoom;
    const x0 = Math.max(0, Math.floor(sx - rp));
    const y0 = Math.max(0, Math.floor(sy - rp));
    const w = Math.min(W, Math.ceil(sx + rp)) - x0;
    const h = Math.min(H, Math.ceil(sy + rp)) - y0;
    if (w <= 0 || h <= 0) return null;
    const d = ctx2d.getImageData(x0, y0, w, h).data;
    let n = 0;
    let sum = 0;
    let sq = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const dx = x0 + i + 0.5 - sx;
      const dy = y0 + j + 0.5 - sy;
      if (dx * dx + dy * dy > rp * rp) continue;
      const o = (j * w + i) * 4;
      const l = (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255;
      n++;
      sum += l;
      sq += l * l;
    }
    const mean = n ? sum / n : 0;
    return { n, srednia: mean, odchylenie: n ? Math.sqrt(Math.max(0, sq / n - mean * mean)) : 0, px: [sx, sy, rp] };
  },
  /**
   * Jasność i barwa PIERŚCIENIA w kadrze widoku z góry (runda 5, poprawki — K4 jako kontrast widoczny w kadrze, porównanie
   * par `?gaz=1` / `?gaz=0`): pierścień r0…r1 j. wokół punktu komory (x, z) na wysokości `y`, w `n` sektorach — średnia
   * luminancja i średnia barwa (0…1) pikseli sektora, po narysowaniu klatki.
   */
  ringStats(x = 0, z = 0, y = 0, r0 = 300, r1 = 440, n = 36) {
    if (state.mode !== 'top') return null;
    render(0);
    const fov = Core3D.cameraPersp?.fov || 35;
    const hc = (H * 0.5) / Math.tan(fov * 0.5 * DEG) / state.cam.zoom;
    const k = hc / (hc + KOMORA.deckY - y);
    const sx = W / 2 + (P0.x + x - state.cam.x) * k * state.cam.zoom;
    const sy = H / 2 + (P0.y + z - state.cam.y) * k * state.cam.zoom;
    const a0 = r0 * k * state.cam.zoom;
    const a1 = r1 * k * state.cam.zoom;
    const x0 = Math.max(0, Math.floor(sx - a1));
    const y0 = Math.max(0, Math.floor(sy - a1));
    const w = Math.min(W, Math.ceil(sx + a1)) - x0;
    const h = Math.min(H, Math.ceil(sy + a1)) - y0;
    if (w <= 0 || h <= 0) return null;
    const d = ctx2d.getImageData(x0, y0, w, h).data;
    const acc = Array.from({ length: n }, () => [0, 0, 0, 0, 0]);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const dx = x0 + i + 0.5 - sx;
      const dy = y0 + j + 0.5 - sy;
      const q = dx * dx + dy * dy;
      if (q < a0 * a0 || q > a1 * a1) continue;
      const sct = Math.min(n - 1, Math.floor((Math.atan2(dy, dx) / (2 * Math.PI) + 0.5) * n));
      const o = (j * w + i) * 4;
      const A = acc[sct];
      A[0]++; A[1] += d[o] / 255; A[2] += d[o + 1] / 255; A[3] += d[o + 2] / 255;
      A[4] += (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255;
    }
    return { px: [sx, sy, a0, a1], sektory: acc.map((A) => A[0] ? [A[4] / A[0], A[1] / A[0], A[2] / A[0], A[3] / A[0]].map((v) => +v.toFixed(4)) : [0, 0, 0, 0]) };
  },
  stats() {
    const sync = pipes.list.filter((p) => p.sync);
    const a = sim.audit();
    return {
      ...lastInfo,
      metal: metalOf(state.metal).id, view: state.view, mode: state.mode, speed: state.speed, live,
      time: S[STAN.time], phase: PHASE_NAMES[S[STAN.phase]], phaseT: S[STAN.phaseT], cycle: S[STAN.cycle], cycleTime: S[STAN.cycleTime],
      radius: S[STAN.radius], temp: S[STAN.temp], heat: S[STAN.heat], coilGlow: S[STAN.coilGlow], radGlow: S[STAN.radGlow],
      suck: S[STAN.suck], sucks: C[LICZNIK.sucks], mach: S[STAN.mach], meltRate: S[STAN.meltRate],
      slag: { ...sim.slagStats(), clean: S[STAN.clean], capAlpha: S[STAN.capAlpha], thread: [S[STAN.thrLo], S[STAN.thrHi]], flow: S[STAN.suckFlow], dump: S[STAN.trayDump] },
      grav: S[STAN.grav], spin: S[STAN.spin], gate: S[STAN.gate],
      display: { mode: S[STAN.dsp], name: DSP_NAMES[S[STAN.dsp]], t: S[STAN.dspT], speed: S[STAN.dspSpeed], turn: S[STAN.dspTurn], flow: S[STAN.dspFlow], u: S[STAN.dspU], v: S[STAN.dspV] },
      heap: { n: C[LICZNIK.heap], radius: S[STAN.heapR], scale: S[STAN.heapScale], heat: S[STAN.heapHeat] },
      drop: {
        fallT: S[STAN.fallT], impactT: S[STAN.impactT], offY: S[STAN.offY], level: S[STAN.level], pool: S[STAN.pool], funHeat: S[STAN.funHeat], throat: S[STAN.throat], lakeR: S[STAN.lakeR],
        vortex: S[STAN.vortex], twist: S[STAN.twist], dimple: S[STAN.dimple],
        // masa w leju (pole grubości): fałda na ścianie, lustro nad gardzielą, najwyższy punkt, czoło, kołysanie, słupy kuli niewlane
        foldY: S[STAN.foldY], humpY: S[STAN.humpY], massTop: S[STAN.massTop], frontR: S[STAN.frontR], slosh: S[STAN.slosh], ballCols: S[STAN.ballCols]
      },
      coils: { r: S[STAN.mach], y: S[STAN.machY], cage: [S[STAN.cageX], S[STAN.cageY], S[STAN.cageZ]], gap: sim.coilGap() },
      tons: sim.tons(),
      gaz: {
        ...sim.gasStats(), zabrane: gasTaken.units / UNITS_PER_TON,
        pole: gaz ? { preset: gaz.preset.nazwa, siatka: [gaz.preset.nx, gaz.preset.ny, gaz.preset.nz], kroki: gaz.stats.steps, dispatche: gaz.stats.dispatches, scalone: gaz.stats.merged, spi: gaz.asleep, masaT: gaz.stats.mass, celT: gaz.stats.target, zanikDodatkowy: gaz.stats.extraDecay, cpuMs: gaz.stats.cpuMs, mb: gaz.grid.bytes / 1048576 } : null,
        przeslona: gasProbeLast
      },
      counts: { belt: C[LICZNIK.belt], flight: C[LICZNIK.flight], heap: C[LICZNIK.heap], floes: sim.view.nKry, granules: sim.view.nGranulki, drops: sim.view.nKrople, sparks: sim.view.nIskry, melts: C[LICZNIK.melts] },
      balance: a.balance, mismatch: a.mismatch,
      sim: { ...timing },
      image: obraz ? { staticVerts: obraz.staticVerts, dynamicVerts: obraz.dyn.n, cover: obraz.cover, coverK: obraz.U.t4.value.x, outsideVerts: zl ? zl.verts : 0 } : null,
      linia: lineStats(),
      zlozenie: { linia: lineOn, zawor: valve.state.open, zaworChce: valve.state.want, dokT: slagDock.state.level, dokRura: slagDock.state.pipe, dokWyplyw: slagDock.state.outT, dokBilans: slagDock.audit() },
      pipelines: {
        total: pipes.list.length, sync: sync.length, syncList: sync.slice(0, 12).map((p) => p.name),
        syncAfterReady: pipes.list.slice(pipes.atReady).filter((p) => p.sync).length,
        syncAfterReadyList: pipes.list.slice(pipes.atReady).filter((p) => p.sync).slice(0, 12).map((p) => p.name)
      },
      gpuMs: Core3D.gpuFrameMs || 0,
      gpuComputeMs: Core3D.gpuComputeMs || 0,
      drganieGazu: !!(Core3D.fx && Core3D.fx.stats && Core3D.fx.stats.distortLayer),
      gpuSamples: [Core3D.gpuFrameSamples || 0, Core3D.gpuComputeSamples || 0],
      fps: state.fps,
      errors: errors.slice()
    };
  },
  /** Linia formowania: stan, koniec wsadu, krokowanie do chwili spływu. */
  linia: {
    stats() { return lineStats(); },
    drain() { if (line) line.drain(); return line ? TRYB_NAMES[line.stan[LIN_STAN.mode]] : null; },
    /** Krokuje do chwili `t` [s] od zetknięcia masy z lejem w NASTĘPNYM (albo bieżącym, jeśli jeszcze przed t) zrzucie. */
    async seekImpact(t = 0) {
      live = false;
      let guard = 0;
      while (guard < 200 * 60 && S[STAN.impactT] >= 0 && S[STAN.impactT] > t + 1e-6) { stepSim(1); guard++; if (guard % 60 === 0) await nextTask(); }
      while (guard < 200 * 60 && !(S[STAN.impactT] >= t - 1e-6)) { stepSim(1); guard++; if (guard % 60 === 0) await nextTask(); }
      return { impactT: S[STAN.impactT], steps: guard, linia: lineStats() };
    },
    /** Krokuje, aż funkcja stanu linii (`stats()`) zwróci prawdę (najwyżej `max` s). */
    async until(fn, max = 60) {
      live = false;
      let guard = 0;
      while (guard < max * 60 && !fn(lineStats())) { stepSim(1); guard++; if (guard % 60 === 0) await nextTask(); }
      return { steps: guard, linia: lineStats() };
    },
    get line() { return line; },
    get obraz() { return linia; },
    /** Walcownia F1–F3 (kinematyka linii; `openMill()` przy `?walcownia=0`). */
    get mill() { return mill; },
    walcownia() { return millStats(); },
    /** (runda 8) dzielenie: stan, konta, wyrób; (runda 9) `odbierz()` — odbiór kasety w trybie `?odbior=stop`. */
    dzielenie() { return dividerStats(); },
    get divider() { return divider; },
    odbierz() { return divider ? divider.odbierz() : false; },
    pasmo: PASMO
  },
  get state() { return state; },
  get cineState() { return cine; },
  get obraz() { return obraz; },
  get gaz() { return gaz; },
  get sim() { return sim; }
};

// ---------------------------------------------------------------------------
// Start
try {
  if (!(await Core3D.ready)) throw new Error(`WebGPU: ${Core3D.gpuError || 'brak urządzenia — demo wymaga przeglądarki z WebGPU'}`);
  hookPipelines();
  deck = new PortBuilding3D({ layout: { id: 'wytop' }, scene: buildMeltDeckScene(style), style, frame: FRAME, name: 'Pokład wytopu' });
  for (const set of Object.values(deck.meshes)) for (const m of set) m.frustumCulled = false;
  host.add(deck.root);
  deck.setLayers(LAYER_BG, LAYER_FG);
  deck.setSun(SUN_OPTS);
  // grupa komory: „hub” zestawu (x, wysokość, z) przesunięty o 280 j. w dół — początek w środku kuli
  const root = new THREE.Group();
  root.name = 'Wytop';
  root.matrixAutoUpdate = false;
  root.matrix.fromArray(portHubMatrixElements(FRAME)).multiply(new THREE.Matrix4().makeTranslation(0, -KOMORA.deckY, 0));
  host.add(root);
  host.updateMatrixWorld(true);
  obraz = new WytopObraz({ root, sim });
  obraz.setLayers(LAYER_BG);
  zl = new ZlozenieObraz({ root, U: obraz.U });
  zl.setLayers(LAYER_BG);
  if (line) {
    linia = new LiniaObraz({ root, U: obraz.U, zl, sparkMaterial: obraz.sparks.mesh.material, sparkData: lineSparks.data, scaleData: scaleDebris ? scaleDebris.data : null });
    linia.setLayers(LAYER_BG);
    // (poprawki rundy 7) `?skorupa=0` — lico skorupy bez spadku temperatury w poprzek (A/B — stan sprzed poprawek)
    if (params.get('skorupa') === '0') linia.skorupa = 0;
    // (runda 8) `?strugaWzor=0` — wzór pól strugi sprzed rundy 8 (A/B: cała struga miga, `strugaWzor.js`)
    if (params.get('strugaWzor') === '0') linia.strugaWzor = 0;
    // (poprawki rundy 8) `?strugaWzor=2` — wzór etapu „Struga — jasność” (pola ×4, pełny kontrast pól na strudze)
    if (params.get('strugaWzor') === '2') linia.strugaWzor = 2;
    if (divider) {
      dz = new DzielenieObraz({ root, U: obraz.U, LM: linia.LM, zl, stations: linia.ST.array });
      dz.setLayers(LAYER_BG);
    }
  }
  // `?zlozenie=0` — bez brył otoczenia (A/B kosztu GPU złożenia)
  if (params.get('zlozenie') === '0') for (const m of zl.meshes) m.visible = false;
  obraz.setSun(...sunChamber(), deck.uniforms.uSunDirW.value);
  // rozgrzewka: budowla zestawu, siatki komory, partie instancji — pierwsza klatka bez kompilacji
  const deckMeshes = [];
  for (const set of Object.values(deck.meshes)) deckMeshes.push(...set);
  await Core3D.warmup.now(deckMeshes, { name: 'wytop: pokład' });
  const wm = obraz.warmupMeshes();
  await Core3D.warmup.now(wm.plain, { name: 'wytop: komora' });
  await Core3D.warmup.now(wm.instanced, { name: 'wytop: partie', variant: WARIANT_INSTANCJI });
  await Core3D.warmup.now(zl.warmupMeshes(), { name: 'formowanie: otoczenie' });
  if (linia) {
    await Core3D.warmup.now(linia.warmupMeshes(), { name: 'formowanie: pasmo' });
    await Core3D.warmup.now(linia.warmupInstanced(), { name: 'formowanie: iskry', variant: WARIANT_INSTANCJI });
  }
  if (dz) {
    await Core3D.warmup.now(dz.warmupMeshes(), { name: 'dzielenie: ostrze' });
    await Core3D.warmup.now(dz.warmupInstanced(), { name: 'dzielenie: arkusze', variant: WARIANT_INSTANCJI });
  }
  // POLE GAZU: krok efektów (kernele rozgrzewa rejestracja kroku — urządzenie jest gotowe), bryły marszu PRZÓD i TYŁ
  // w passie komory, tarcza drgania w warstwie zniekształceń
  if (gasOn) {
    // (strojenie w harnessie: `?gazFiz=klucz:wartość,…` nadpisuje liczby fizyki pola; `?gazWyglad=…` — wyglądu)
    const kv = (q) => (q ? Object.fromEntries(q.split(',').map((e) => e.split(':')).filter((e) => e.length === 2 && Number.isFinite(Number(e[1]))).map(([k, v]) => [k, Number(v)])) : null);
    gaz = createWytopGaz(Core3D, { root, preset: gasPreset, layer: LAYER_BG, metal: metalOf(state.metal), fiz: kv(params.get('gazFiz')) });
    if (params.get('gazWyglad')) gaz.setLook(kv(params.get('gazWyglad')));
    host.updateMatrixWorld(true);
    await Core3D.warmup.now(gaz.meshes.volume, { name: 'wytop: gaz' });
    await Core3D.warmup.now(gaz.meshes.heat, { name: 'wytop: gaz — drganie' });
  }
  setSpeed(state.speed);
  {
    const vq = params.get('view');
    const vk = vq === null ? 1 : VIEWS.some((q) => q.key === vq) ? vq : Number(vq);
    applyView(VIEWS.some((q) => q.key === vk) ? vk : 1);
  }
  syncUi();
  // klatki rozruchu: kula rysowana także przy pustej komorze (pipeline gotowy przed pierwszym topieniem)
  obraz.forceBall = true;
  for (let k = 0; k < 5; k++) { render(0); await new Promise((ok) => setTimeout(ok, 30)); }
  obraz.forceBall = false;
  render(0);
  pipes.atReady = pipes.list.length;
  window.__wytop.ready = true;
  if (!shotMode) {
    lastMs = performance.now();
    requestAnimationFrame(loop);
  }
} catch (err) {
  reportError(err.stack || String(err));
}
