// Próba 1 planu LOD (docs/PLAN-zawalenia-lod-miasto.md § 5): czy grubszy woksel zachowuje się tak samo. Tylko ?test=1.
// Scena S1 przy danym dx i materiale, liczby z tych samych metryk co tabela § 8 (ObserwatorSceny), czasy ze znaczników. Kratka kawałków także w jednostkach gry: kosze metryk liczą węzły, a węzeł przy dx = 80 waży 64 razy tyle co przy dx = 20.
import { S1Lod, stanieLod, planGpu } from './scena.js';
import { planStanieMiasta } from './scenaMiasta.js';
import { popcnt, zbudujPlan } from './budowa.js';
import { ObserwatorSceny, pietraStropow, taca, wysokoscDachu } from './metryki.js';

const liczNaN = (t) => { let c = 0; for (let i = 0; i < t.length; i++) if (t[i] !== t[i]) c++; return c; };

function asymetrie(w, maska) {
  let c = 0;
  for (let e = 0; e < w.mW; e++) {
    const a = w.wa[e], d = w.wd[e], b = w.wb[e];
    if (((maska[a] >>> d) & 1) !== ((maska[b] >>> (d ^ 1)) & 1)) c++;
  }
  return c;
}

const srednia = (x) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : null);
const mediana = (x) => (x.length ? x.slice().sort((a, b) => a - b)[x.length >> 1] : null);

/** Rozmiar kawałka w jednostkach gry: mediana po masie, bok sześcianu o objętości kawałka, razem z pustą częścią budynku liczoną jak w scenie (węzeł = dx³). */
function bokKawalka(n, etykiety, dx) {
  const roz = new Map();
  for (let i = 0; i < n; i++) if (etykiety[i] >= 0) roz.set(etykiety[i], (roz.get(etykiety[i]) ?? 0) + 1);
  const l = [...roz.values()].sort((a, b) => a - b);
  const suma = l.reduce((s, v) => s + v, 0);
  let nar = 0;
  for (const v of l) { nar += v; if (nar >= 0.5 * suma) return Math.cbrt(v) * dx; }
  return 0;
}

export function createTestLod({ renderer, solver, wok }) {
  const backend = renderer.backend;

  /** Jeden bieg S1. o: { dx, mat: 'staly' | 'dx', wieza, T, nakladka, w1: sekundy stania } */
  async function s1(o = {}) {
    const dx = o.dx ?? 20;
    const t0 = performance.now();
    const plan = S1Lod(o);
    if (plan.scena.n > solver.maxNodes) return { dx, mat: o.mat ?? 'staly', n: plan.scena.n, poza: `${plan.scena.n} węzłów, MAX ${solver.maxNodes}` };
    const { w, g } = zbudujPlan(plan, {});
    const msBudowy = performance.now() - t0;
    if (o.T) plan.T = o.T;
    solver.wczytaj(w);
    solver.ustawPlan(g);
    const n = w.n, N = Math.round(plan.T * 60);
    const ob = new ObserwatorSceny(plan);
    const pp = pietraStropow(plan.scena);
    const stan = { n, pos: null, vel: null, aktywny: null, maskaW: null, wa: w.wa, wb: w.wb, wd: w.wd, mW: w.mW, nbr: w.nbr, iN0: w.iN0, zerwanych: 0 };
    const fW1 = Math.max(0, Math.ceil(plan.zdarzeniaOd * 60) - 1);
    let fG = 0, odczytow = 0, nan = 0, asym = 0, zerwanePrzed = 0, ostatnie = null;
    const czasyStoi = [], czasyWali = [];
    let bity0 = 0;
    for (let i = 0; i < n; i++) bity0 += popcnt(w.maska[i]);
    const dokroku = async (cel) => {
      // Znaczniki: 60 kroków stania i 120 kroków walenia, reszta bez nich, żeby kolejka szła jak w pokazie.
      while (fG < cel) {
        const stoi = fG >= 60 && fG < 110;
        const wali = fG >= 180 && fG < 300;
        const q = stoi || wali ? 1 : Math.min(cel - fG, 8 - (fG % 8));
        wok.wyczyscCzasy();
        await wok.krok(q, { mierz: stoi || wali });
        if (stoi) czasyStoi.push(...wok.czasy().fizyka);
        if (wali) czasyWali.push(...wok.czasy().fizyka);
        if (stoi || wali) backend.timestampQueryPool?.compute?.timestamps?.clear?.();
        fG += q;
      }
    };
    const s = w.skalaBud ?? 1;
    // Przy budynku w skali s wszystko idzie √s razy szybciej, więc gęstszy odczyt. dachF: dach / wysokość w chwili t* = (t − 2) / √s, czyli w czasie wieży z kalibracji.
    const co = s < 0.6 ? 5 : 15;
    const czyCzytac = (f) => f === N || f % co === 0 || f % 15 === 0 || (f + 1) % 15 === 0 || f === fW1 || f === fW1 - 1;
    const dachF = [];
    const hBud = plan.scena.meta.h;
    const wszyscy = Int32Array.from({ length: n }, (_, i) => i);
    for (let f = 0; f <= N; f++) {
      if (!czyCzytac(f)) continue;
      await dokroku(f);
      const r = f === 0
        ? { pos: w.pos, vel: w.vel0 ?? new Float32Array(3 * n), aktywny: new Uint8Array(n).fill(1), maskaW: w.maska }
        : await solver.odczytLekki(renderer);
      odczytow++;
      stan.pos = r.pos; stan.vel = r.vel; stan.aktywny = r.aktywny; stan.maskaW = r.maskaW;
      ob.klatka(f, stan);
      dachF.push([(f / 60 - 2) / Math.sqrt(s), wysokoscDachu(r.pos, n, { maska: r.aktywny, podzbior: wszyscy }) / hBud]);
      ostatnie = r;
      if (f % 15 === 0) { nan += liczNaN(r.pos) + liczNaN(r.vel); asym += asymetrie(w, r.maskaW); }
      if (f === fW1) { let b = 0; for (let i = 0; i < n; i++) b += popcnt(r.maskaW[i]); zerwanePrzed = bity0 - b; }
    }
    const p = ob.koniec(stan);
    const pelny = await solver.odczyt(renderer);
    nan += liczNaN(pelny.poz) + liczNaN(pelny.vel) + liczNaN(pelny.acc) + liczNaN(pelny.szkoda) + liczNaN(pelny.A) + liczNaN(pelny.L) + liczNaN(pelny.D);
    const dach = {}, przechylT = {};
    for (const e of ob.wpisy) { dach[e.t] = e.wieza.dach; przechylT[e.t] = e.wieza.przechyl.sztywnyStopnie; }
    // Przechył spójny w metrykach ma próg reszty 1,5 dx, czyli przy dx = 80 aż 120 j.: rozbita góra liczy się tam jako cała. Porównanie między dx ze stałym progiem w jednostkach gry, 30 j. jak 1,5 dx przy dx = 20 razy skala budynku.
    const progReszty = 30 * (plan.scena.meta.h / 1340);
    let przechylStaly = 0, tStaly = 0;
    for (const e of ob.wpisy) {
      const q = e.wieza.przechyl;
      if (q.reszta < progReszty && q.sztywnyStopnie > przechylStaly) { przechylStaly = q.sztywnyStopnie; tStaly = e.t; }
    }
    const dachGw = (ts) => {
      if (ts > dachF.at(-1)[0]) return null;
      for (let q = 1; q < dachF.length; q++) if (dachF[q][0] >= ts) { const [a, b] = dachF[q - 1], [c, e] = dachF[q]; return b + ((e - b) * (ts - a)) / (c - a); }
      return null;
    };
    const dachNorm = [0.5, 1, 2, 3, 4, 5].map(dachGw);
    const koncowe = p.koniec.wieza.wyspy;
    const taca5 = pp ? taca(stan, pp) : null;
    const maxMasa = koncowe.masa.reduce((s, v) => s + v, 0) || 1;
    const stoiMs = mediana(czasyStoi), waliMs = mediana(czasyWali);
    const zywychT5 = p.koniec.aktywnych;
    const bok = bokKawalka(n, koncoweEtykiety(p, n, stan, w), dx);
    return {
      dx, mat: o.mat ?? 'staly', etykieta: o.etykieta ?? null, n, c: w.cEf, K: w.K, podkroki: w.podkrokiEf, rytm: w.rytmEf, h: w.h, stabilnosc: w.h * Math.sqrt(12 * w.K),
      meta: { nx: plan.scena.meta.nx, ny: plan.scena.meta.ny, nz: plan.scena.meta.nz, w: plan.scena.meta.w, d: plan.scena.meta.d, h: plan.scena.meta.h, pietroCo: plan.scena.meta.pietroCo, gruboscStropu: plan.scena.meta.gruboscStropu, liczby: plan.scena.meta.liczby },
      kalibracja: { iter: w.info.grupy.wieza.iter, residuum: w.info.grupy.wieza.residuum, maxU: w.info.grupy.wieza.maxUgiecieLiniowe, maxF0: w.info.grupy.wieza.maxF0, odk: w.info.grupy.wieza.odkMax },
      T: plan.T, N, msBudowy, odczytow, dach, przechylT, dachNorm, skalaBud: s,
      przechylSpojny: p.historia.maxPrzechylSpojny, tPrzechylu: p.historia.tMaxPrzechylSpojny, przechylMax: p.historia.maxPrzechyl, przechylStaly, tStaly,
      W1przed: { przem: p.W1.maxPrzemieszczenie, vRms: p.W1.vRms, opad: p.W1.opadDachu, zerwaneBity: zerwanePrzed },
      masa: koncowe.masa.map((v) => (100 * v) / maxMasa), masaWezly: koncowe.masa, najwiekszy: koncowe.najwieksza, wysp: koncowe.liczbaWysp, bokKawalka: bok, zywych: zywychT5, usuniete: n - zywychT5,
      taca: taca5, nan, asym, bledyGpu: wok.bledy().length,
      msStoi: stoiMs, msWali: waliMs, msStoiSr: srednia(czasyStoi), msWaliSr: srednia(czasyWali), nsNaWezelKrok: waliMs === null ? null : (1e6 * waliMs) / n,
      ...(ostatnie ? {} : {}),
    };
  }

  function koncoweEtykiety(p, n, stan, w) {
    // Etykiety z końca biegu: metryki trzymają je w ostatnim wpisie tylko na chwilę, więc liczone jeszcze raz z masek.
    const rodzic = new Int32Array(n);
    for (let i = 0; i < n; i++) rodzic[i] = i;
    const zn = (x) => { while (rodzic[x] !== x) { rodzic[x] = rodzic[rodzic[x]]; x = rodzic[x]; } return x; };
    for (let e = 0; e < w.mW; e++) {
      const a = w.wa[e], b = w.wb[e];
      if (!stan.aktywny[a] || !stan.aktywny[b]) continue;
      if (!((stan.maskaW[a] >>> w.wd[e]) & 1)) continue;
      const ra = zn(a), rb = zn(b);
      if (ra !== rb) rodzic[ra] = rb;
    }
    const et = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) if (stan.aktywny[i]) et[i] = zn(i);
    return et;
  }

  /** W1 przy dx: stanie sekund, bez zdarzeń. */
  async function w1(o = {}) {
    const plan = stanieLod({ ...o, T: o.sekund ?? 60 });
    if (plan.scena.n > solver.maxNodes) return { dx: o.dx, poza: `${plan.scena.n} węzłów` };
    const { w, g } = zbudujPlan(plan, {});
    solver.wczytaj(w);
    solver.ustawPlan({ ...g, czasy: null });
    const sek = o.sekund ?? 60;
    const tP = performance.now();
    await wok.krok(60 * sek);
    const r = await solver.odczyt(renderer);
    let mx = 0, vm = 0, bity = 0, bity0 = 0, zmask = 0, sMax = 0;
    for (let i = 0; i < w.n; i++) {
      const a = r.poz[3 * i] - w.pos[3 * i], b = r.poz[3 * i + 1] - w.pos[3 * i + 1], c = r.poz[3 * i + 2] - w.pos[3 * i + 2];
      mx = Math.max(mx, a * a + b * b + c * c);
      vm = Math.max(vm, r.vel[3 * i] ** 2 + r.vel[3 * i + 1] ** 2 + r.vel[3 * i + 2] ** 2);
      bity += popcnt(r.maskaW[i]);
      bity0 += popcnt(w.maska[i]);
      if (r.maskaW[i] !== w.maska[i]) zmask++;
      sMax = Math.max(sMax, r.szkoda[i]);
    }
    const nan = liczNaN(r.poz) + liczNaN(r.vel) + liczNaN(r.acc);
    return { dx: o.dx, mat: o.mat ?? 'staly', n: w.n, sekund: sek, msSciany: performance.now() - tP, maxPrzem: Math.sqrt(mx), vMax: Math.sqrt(vm), zerwaneBity: bity0 - bity, wezlyZInnaMaska: zmask, sMax, nan, zaliczony: Math.sqrt(mx) <= 0.5 && bity0 === bity && nan === 0 };
  }

  /** W1 dzielnicy (plan LOD § 5, próba 2): stoi sekund, bez zdarzeń. Budowa i wczytanie jak w pokazie, odczyt raz na końcu. */
  async function miastoW1(o = {}) {
    const t0 = performance.now();
    const plan = planStanieMiasta(o);
    if (plan.scena.n > solver.maxNodes) return { dx: o.dx, n: plan.scena.n, poza: `${plan.scena.n} węzłów, MAX ${solver.maxNodes}` };
    const { w, g } = zbudujPlan(plan, {});
    const msBudowy = performance.now() - t0;
    solver.wczytaj(w);
    solver.ustawPlan({ ...g, czasy: null });
    const sek = o.sekund ?? 5;
    const tP = performance.now();
    await wok.krok(60 * sek);
    const msSciany = performance.now() - tP;
    const r = await solver.odczyt(renderer);
    let mx = 0, vm = 0, bity = 0, bity0 = 0, zmask = 0, sMax = 0;
    const budynki = plan.miasto.budynki;
    let zerwaneBudynki = 0;
    for (const b of budynki) {
      let zm = 0;
      for (let i = b.start; i < b.start + b.n; i++) {
        const a = r.poz[3 * i] - w.pos[3 * i], c = r.poz[3 * i + 1] - w.pos[3 * i + 1], e = r.poz[3 * i + 2] - w.pos[3 * i + 2];
        mx = Math.max(mx, a * a + c * c + e * e);
        vm = Math.max(vm, r.vel[3 * i] ** 2 + r.vel[3 * i + 1] ** 2 + r.vel[3 * i + 2] ** 2);
        bity += popcnt(r.maskaW[i]);
        bity0 += popcnt(w.maska[i]);
        if (r.maskaW[i] !== w.maska[i]) { zmask++; zm++; }
        sMax = Math.max(sMax, r.szkoda[i]);
      }
      if (zm) zerwaneBudynki++;
    }
    const nan = liczNaN(r.poz) + liczNaN(r.vel) + liczNaN(r.acc);
    // Ścisk siatki kontaktów: tyle zajętych komórek i tyle węzłów ponad 23 w komórce po haszu (§ 2.7).
    const kom = new Map();
    const iKom = w.iKom, mk = solver.atrybuty.komLicz.count - 1;
    for (let i = 0; i < w.n; i++) {
      const a = Math.floor(r.poz[3 * i] * iKom), c = Math.floor(r.poz[3 * i + 1] * iKom), e = Math.floor(r.poz[3 * i + 2] * iKom);
      const h = ((Math.imul(a, 73856093) ^ Math.imul(c, 19349663) ^ Math.imul(e, 83492791)) >>> 0) & mk;
      kom.set(h, (kom.get(h) ?? 0) + 1);
    }
    let maxKom = 0, ponad = 0;
    for (const v of kom.values()) { if (v > maxKom) maxKom = v; if (v > 23) ponad += v - 23; }
    return {
      dx: o.dx, n: w.n, budynkow: budynki.length, statyk: w.info.grupy.wieza.statyk, iterMax: w.info.grupy.wieza.iter, msBudowy, sekund: sek, msSciany, podkroki: w.podkrokiEf, rytm: w.rytmEf, c: w.cEf,
      maxPrzem: Math.sqrt(mx), vMax: Math.sqrt(vm), zerwaneBity: bity0 - bity, wezlyZInnaMaska: zmask, zerwaneBudynki, sMax, nan,
      siatka: { zajete: kom.size, nKom: mk + 1, maxWKomorce: maxKom, ponad23: ponad },
      zaliczony: Math.sqrt(mx) <= 0.5 && bity0 === bity && nan === 0,
    };
  }

  return { s1, w1, miastoW1 };
}
