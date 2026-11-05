// Liczby K1–K6 sceny S5 na GPU (docs/SPEC-woksele-zawalenia.md § 5.5), tylko ?test=1. Miary to port `Miary` z proby5/final/scena5.mjs bez zmian w definicjach.
// Odczyt co 15 klatek, gęściej tylko tam, gdzie miara potrzebuje chwili: pierwszy styk, przejście szczytu wieży przez dysk, pierwszy dotyk gruntu.
import { S5 } from './scena.js';
import { zbudujPlan } from './budowa.js';

const FPS = 60;

function popc(x) { let c = 0; x &= 0x3ffff; while (x) { x &= x - 1; c++; } return c; }

/** Kawałki dysku z żywych wiązań: rozmiary, etykiety, statystyki. */
export function kawalki(m, dane) {
  const { nW, nD } = dane;
  const rodz = new Int32Array(m.n);
  for (let i = 0; i < m.n; i++) rodz[i] = i;
  const zn = (a) => { while (rodz[a] !== a) { rodz[a] = rodz[rodz[a]]; a = rodz[a]; } return a; };
  for (let i = nW; i < nW + nD; i++) {
    if (!m.aktywny[i]) continue;
    let mk = m.maskaW[i] & 0x3ffff;
    while (mk) { const b = mk & -mk; mk ^= b; const d = 31 - Math.clz32(b); const j = m.nbr[18 * i + d]; if (j >= 0) { const a = zn(i), c = zn(j); if (a !== c) rodz[a] = c; } }
  }
  const roz = new Map();
  for (let i = nW; i < nW + nD; i++) if (m.aktywny[i]) { const a = zn(i); roz.set(a, (roz.get(a) ?? 0) + 1); }
  let kot = 0;
  const naKot = new Set();
  for (let i = nW; i < nW + nD; i++) if (m.aktywny[i] && m.nieruchomy[i]) naKot.add(zn(i));
  for (const a of naKot) kot += roz.get(a);
  let najw = 0, b64 = 0, b1_7 = 0, b8_63 = 0, ile64 = 0;
  for (const v of roz.values()) {
    if (v > najw) najw = v;
    if (v >= 64) { b64 += v; ile64++; } else if (v < 8) b1_7 += v; else b8_63 += v;
  }
  return { roz, zn, najw, b64, b1_7, b8_63, ile64, kot };
}

/** Oś wieży z dolnych i górnych 15% węzłów (po ijk). */
export function osWiezy(m, dane) {
  const { nW } = dane;
  const nz = m.scena.meta.wieza.nz;
  const a = [0, 0, 0], b = [0, 0, 0];
  let na = 0, nb = 0;
  for (let i = 0; i < nW; i++) {
    if (!m.aktywny[i]) continue;
    const k = m.scena.ijk[3 * i + 2];
    if (k < 0.15 * nz) { a[0] += m.pos[3 * i]; a[1] += m.pos[3 * i + 1]; a[2] += m.pos[3 * i + 2]; na++; } else if (k >= 0.85 * nz) { b[0] += m.pos[3 * i]; b[1] += m.pos[3 * i + 1]; b[2] += m.pos[3 * i + 2]; nb++; }
  }
  if (!na || !nb) return null;
  const v = [b[0] / nb - a[0] / na, b[1] / nb - a[1] / na, b[2] / nb - a[2] / na];
  const l = Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
  return { kat: (Math.acos(Math.min(1, Math.abs(v[2]) / l)) * 180) / Math.PI, v };
}

/** Otwór: pusta komórka górnego pokładu (kratka 40 j.), węzły przemieszczone o ponad 50 j. w z pokładu nie tworzą. Największa spójna składowa, PCA. */
export function otwor(m, dane) {
  const { nW, nD, o } = dane;
  const S = 40, N = Math.ceil((2 * o.R) / S) + 2;
  const pel = new Uint8Array(N * N);
  const nzD = m.scena.meta.dysk.nz;
  let zRef = m.scena.meta.dysk.zGora - 10;
  const zs = [];
  for (let i = nW; i < nW + nD; i += 11) if (m.aktywny[i] && m.scena.ijk[3 * i + 2] === nzD - 1) zs.push(m.pos[3 * i + 2]);
  if (zs.length) { zs.sort((a, b) => a - b); zRef = zs[zs.length >> 1]; }
  for (let i = nW; i < nW + nD; i++) {
    if (!m.aktywny[i] || m.scena.ijk[3 * i + 2] !== nzD - 1) continue;
    if (Math.abs(m.pos[3 * i + 2] - zRef) > 50) continue;
    const a = Math.floor((m.pos[3 * i] + o.R) / S + 1), b = Math.floor((m.pos[3 * i + 1] + o.R) / S + 1);
    if (a >= 0 && b >= 0 && a < N && b < N) pel[b * N + a] = 1;
  }
  const odw = new Uint8Array(N * N);
  let najw = null;
  const st = [];
  const Rw = o.R - 2.5 * S;
  const wDysku = (a, b) => { const x = (a - 1 + 0.5) * S - o.R, y = (b - 1 + 0.5) * S - o.R; return x * x + y * y < Rw * Rw; };
  for (let b = 0; b < N; b++) for (let a = 0; a < N; a++) {
    if (pel[b * N + a] || odw[b * N + a] || !wDysku(a, b)) continue;
    st.length = 0; st.push(a, b); odw[b * N + a] = 1;
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, c = 0;
    while (st.length) {
      const y0 = st.pop(), x0 = st.pop();
      sx += x0; sy += y0; sxx += x0 * x0; syy += y0 * y0; sxy += x0 * y0; c++;
      for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const A = x0 + da, B = y0 + db;
        if (A < 0 || B < 0 || A >= N || B >= N || pel[B * N + A] || odw[B * N + A] || !wDysku(A, B)) continue;
        odw[B * N + A] = 1; st.push(A, B);
      }
    }
    if (!najw || c > najw.c) {
      const mx = sx / c, my = sy / c;
      const a11 = sxx / c - mx * mx, a22 = syy / c - my * my, a12 = sxy / c - mx * my;
      const tr = a11 + a22, de = Math.sqrt(Math.max(0, (a11 - a22) ** 2 / 4 + a12 * a12));
      const l1 = tr / 2 + de, l2 = Math.max(1e-6, tr / 2 - de);
      najw = { c, pole: c * S * S, stosunek: Math.sqrt(l1 / l2), dl: 4 * Math.sqrt(l1) * S, szer: 4 * Math.sqrt(l2) * S };
    }
  }
  return najw;
}

/** Prędkości kawałków względem środka masy dysku: mediana po masie (K4), po kawałkach 8+ bez wag i po węzłach. */
function predkosci(m, dane, ka) {
  const { nW, nD } = dane;
  let vx = 0, vy = 0, vz = 0, akt = 0;
  for (let i = nW; i < nW + nD; i++) if (m.aktywny[i]) { vx += m.vel[3 * i]; vy += m.vel[3 * i + 1]; vz += m.vel[3 * i + 2]; akt++; }
  vx /= akt; vy /= akt; vz /= akt;
  const wKaw = new Map();
  for (let i = nW; i < nW + nD; i++) {
    if (!m.aktywny[i]) continue;
    const a = ka.zn(i);
    let w = wKaw.get(a);
    if (!w) { w = { c: 0, x: 0, y: 0, z: 0 }; wKaw.set(a, w); }
    w.c++; w.x += m.vel[3 * i]; w.y += m.vel[3 * i + 1]; w.z += m.vel[3 * i + 2];
  }
  const vk = [];
  let vMax8 = 0;
  for (const w of wKaw.values()) {
    const s = Math.sqrt((w.x / w.c - vx) ** 2 + (w.y / w.c - vy) ** 2 + (w.z / w.c - vz) ** 2);
    if (w.c >= 8) { vk.push([s, w.c]); if (s > vMax8) vMax8 = s; }
  }
  vk.sort((a, b) => a[0] - b[0]);
  let cum = 0, med = 0;
  const sumM = vk.reduce((q, w) => q + w[1], 0);
  for (const [s, c] of vk) { cum += c; if (cum >= sumM / 2) { med = s; break; } }
  const vWez = [];
  for (let i = nW; i < nW + nD; i++) if (m.aktywny[i]) vWez.push(Math.sqrt((m.vel[3 * i] - vx) ** 2 + (m.vel[3 * i + 1] - vy) ** 2 + (m.vel[3 * i + 2] - vz) ** 2));
  vWez.sort((a, b) => a - b);
  return { medMasa: med, medBezwag: vk.length ? vk[vk.length >> 1][0] : 0, medWezel: vWez[vWez.length >> 1], max8: vMax8, ile8: vk.length };
}

/** Czystość kawałków 64+ wobec sekcji (udział dominującej sekcji ważony masą). */
function czystoscKawalkow(m, dane, ka) {
  const { nW, nD, seg } = dane;
  const mapa = new Map();
  for (let i = nW; i < nW + nD; i++) {
    if (!m.aktywny[i]) continue;
    const a = ka.zn(i);
    if (ka.roz.get(a) < 64) continue;
    let w = mapa.get(a);
    if (!w) { w = new Map(); mapa.set(a, w); }
    const s = seg[i - nW];
    w.set(s, (w.get(s) ?? 0) + 1);
  }
  let suma = 0, dom = 0;
  for (const w of mapa.values()) {
    let cal = 0, mx = 0;
    for (const v of w.values()) { cal += v; if (v > mx) mx = v; }
    suma += cal; dom += mx;
  }
  return dom / Math.max(1, suma);
}

/** Najdłuższy spójny odcinek wieży (drabina): rozpiętość k kawałka 32+ jako ułamek wysokości. */
function drabina(m, dane) {
  const { nW } = dane;
  const rodz = new Int32Array(nW);
  for (let i = 0; i < nW; i++) rodz[i] = i;
  const zn = (a) => { while (rodz[a] !== a) { rodz[a] = rodz[rodz[a]]; a = rodz[a]; } return a; };
  for (let i = 0; i < nW; i++) {
    if (!m.aktywny[i]) continue;
    let mk = m.maskaW[i] & 0x3ffff;
    while (mk) { const b = mk & -mk; mk ^= b; const d = 31 - Math.clz32(b); const j = m.nbr[18 * i + d]; if (j >= 0 && j < nW) { const a = zn(i), c = zn(j); if (a !== c) rodz[a] = c; } }
  }
  const zak = new Map();
  for (let i = 0; i < nW; i++) {
    if (!m.aktywny[i]) continue;
    const a = zn(i), k = m.scena.ijk[3 * i + 2];
    let w = zak.get(a);
    if (!w) { w = { c: 0, mn: k, mx: k }; zak.set(a, w); }
    w.c++; if (k < w.mn) w.mn = k; if (k > w.mx) w.mx = k;
  }
  let naj = 0, najw = 0, ile = 0;
  for (const w of zak.values()) { if (w.c < 32) continue; ile++; if (w.c > najw) najw = w.c; const r = w.mx - w.mn + 1; if (r > naj) naj = r; }
  return { rozpietosc: naj / m.scena.meta.wieza.nz, najwiekszy: najw / nW, kawalkow32: ile };
}

const r3 = (x) => +x.toFixed(3);

export function createTestS5({ renderer, solver, wok }) {
  const pamiecStatyki = new Map();

  /** Jeden bieg S5 na GPU. Zwraca miary jak `Miary.koniec` w scena5.mjs. opcje: nadpisanie S5_OPCJE (strojenie). */
  async function s5({ miejsce = 'g', ziarno = 21, T = null, opcje = {} } = {}) {
    const plan = S5({ ...opcje, miejsce, ziarno });
    const { w, g } = zbudujPlan(plan, { pamiecStatyki });
    const dane = plan.dane;
    const { nW, nD } = dane;
    const n = w.n;
    solver.wczytaj(w);
    solver.ustawPlan(g);
    const Tk = T ?? plan.T;
    const N = Math.round(Tk * FPS);
    const gruntZ = w.gruntZ;
    const maGrunt = gruntZ > -1e20;
    const zG = gruntZ + 0.5 * w.dx + 2;
    const pos0 = plan.scena.pos;
    const zera = new Uint8Array(n);
    const m = { n, nbr: w.nbr, scena: plan.scena, nieruchomy: w.nieruchomy, pos: pos0, vel: w.vel0, aktywny: new Uint8Array(n).fill(1), maskaW: w.maska, iN0: w.iN0 };
    const sumaP = () => { let x = 0, y = 0, z = 0; for (let i = 0; i < n; i++) if (m.aktywny[i]) { x += m.vel[3 * i]; y += m.vel[3 * i + 1]; z += m.vel[3 * i + 2]; } return [x, y, z]; };
    const com = () => { let x = 0, y = 0, z = 0, c = 0; for (let i = 0; i < n; i++) if (m.aktywny[i]) { x += m.pos[3 * i]; y += m.pos[3 * i + 1]; z += m.pos[3 * i + 2]; c++; } return [x / c, y / c, z / c]; };
    const P0 = sumaP(), C0 = com(), V0 = [P0[0] / n, P0[1] / n, P0[2] / n];
    const fPierwsza = plan.wybuchy.length ? plan.wybuchy[0].f : Infinity;
    let maxDP = 0, maxOdchCom = 0, nan = 0, asym = 0;
    let tStyk = -1, thStyk = -1, otworSzczyt = null, otworPrzed = null, otwor36 = null;
    const th0 = osWiezy(m, dane)?.kat ?? 0;
    let tWiezaGrunt = -1, tDyskGrunt = -1, tDuzyGrunt = -1, rozDuzy = 0, tDuzy512 = -1, roz512 = 0, wiezaPrzy512 = -1;
    const hist = [];
    const predT = [];
    const maxPred = { medMasa: 0, medBezwag: 0, medWezel: 0, max8: 0, ile8: 0 };
    let fG = 0, odczytow = 0, msKroki = 0;
    // Odczyt co 15 klatek, a gęściej tylko tam, gdzie miara czeka na chwilę.
    const czyCzytac = (f) => f === N || f % 15 === 0
      || (tStyk < 0 && f <= 150)
      || (!otworSzczyt && f >= 60 && f % 3 === 0)
      || f === fPierwsza - 1 || f === 216
      || (maGrunt && tDuzy512 < 0 && f >= 120 && f % 2 === 0);
    const asymetrie = () => { let q = 0; for (let i = 0; i < n; i++) { if (!m.aktywny[i]) continue; let mk = m.maskaW[i] & 0x3ffff; while (mk) { const b = mk & -mk; mk ^= b; const d = 31 - Math.clz32(b); const j = w.nbr[18 * i + d]; if (j < 0 || !((m.maskaW[j] >>> (d ^ 1)) & 1)) q++; } } return q; };
    const naNy = (t) => { let q = 0; for (let i = 0; i < t.length; i++) if (!Number.isFinite(t[i])) q++; return q; };
    for (let f = 1; f <= N; f++) {
      if (!czyCzytac(f)) continue;
      const t00 = performance.now();
      await wok.krok(f - fG);
      msKroki += performance.now() - t00;
      fG = f;
      const o = await solver.odczytLekki(renderer);
      odczytow++;
      m.pos = o.pos; m.vel = o.vel; m.aktywny = o.aktywny; m.maskaW = o.maskaW;
      if (g.puscKotwiceF >= 0 && f > g.puscKotwiceF) m.nieruchomy = zera;
      const t = f / FPS;
      if (tStyk < 0) {
        let vm = 0;
        for (let i = nW; i < nW + nD; i++) { const q = m.vel[3 * i] ** 2 + m.vel[3 * i + 1] ** 2 + m.vel[3 * i + 2] ** 2; if (q > vm) vm = q; }
        if (vm > 1) { tStyk = t; thStyk = osWiezy(m, dane)?.kat ?? -1; }
      }
      if (!otworSzczyt) {
        const nz = plan.scena.meta.wieza.nz;
        let s = 0, c = 0;
        for (let i = 0; i < nW; i++) if (m.aktywny[i] && plan.scena.ijk[3 * i + 2] >= 0.85 * nz) { s += m.pos[3 * i + 2]; c++; }
        if (c && s / c < 0) otworSzczyt = { t, ...(otwor(m, dane) ?? {}) };
      }
      if (f === fPierwsza - 1) otworPrzed = { t, ...(otwor(m, dane) ?? {}) };
      if (f === 216) otwor36 = { t, ...(otwor(m, dane) ?? {}) };
      if (maGrunt && tWiezaGrunt < 0) { for (let i = 0; i < nW; i++) if (m.aktywny[i] && m.pos[3 * i + 2] < zG) { tWiezaGrunt = t; break; } }
      if (maGrunt && tDuzy512 < 0) {
        let jest = false;
        for (let i = nW; i < nW + nD; i++) if (m.aktywny[i] && m.pos[3 * i + 2] < zG) { jest = true; break; }
        if (jest && tDyskGrunt < 0) tDyskGrunt = t;
        if (jest) {
          const ka = kawalki(m, dane);
          let naj = 0;
          for (let i = nW; i < nW + nD; i++) if (m.aktywny[i] && m.pos[3 * i + 2] < zG) { const v = ka.roz.get(ka.zn(i)); if (v > naj) naj = v; }
          if (naj >= 64 && tDuzyGrunt < 0) { tDuzyGrunt = t; rozDuzy = naj; }
          if (naj >= 512) {
            tDuzy512 = t; roz512 = naj;
            let wa = 0, wg = 0;
            for (let i = 0; i < nW; i++) if (m.aktywny[i]) { wa++; if (m.pos[3 * i + 2] < gruntZ + 200) wg++; }
            wiezaPrzy512 = wg / Math.max(1, wa);
          }
        }
      }
      if (f % 15 === 0 || f === N) {
        nan += naNy(o.pos) + naNy(o.vel);
        asym += asymetrie();
        const P = sumaP();
        const dP = Math.sqrt((P[0] - P0[0]) ** 2 + (P[1] - P0[1]) ** 2 + (P[2] - P0[2]) ** 2) / n;
        if (dP > maxDP) maxDP = dP;
        if (dane.prozn) {
          const c = com();
          const q = Math.sqrt((c[0] - C0[0] - V0[0] * t) ** 2 + (c[1] - C0[1] - V0[1] * t) ** 2 + (c[2] - C0[2] - V0[2] * t) ** 2);
          if (q > maxOdchCom) maxOdchCom = q;
        }
        if (f % 60 === 0) {
          const ka = kawalki(m, dane);
          let c = 0, nad = 0;
          for (let i = nW; i < nW + nD; i++) if (m.aktywny[i]) { c++; if (m.pos[3 * i + 2] < pos0[3 * i + 2] - 500) nad++; }
          const os = osWiezy(m, dane);
          const pr = predkosci(m, dane, ka);
          // medMasa w locie to miara rozjazdu płyt: czy dysk jest już kawałkami, czy jedną spękaną płytą (§ 5.5, znana słabość).
          hist.push({ t, th: os ? +os.kat.toFixed(1) : null, najw: r3(ka.najw / nD), b64: r3(ka.b64 / nD), b1_7: r3(ka.b1_7 / nD), ile64: ka.ile64, kot: r3(ka.kot / nD), pod500: c ? r3(nad / c) : 0, medMasa: +pr.medMasa.toFixed(1) });
          if (t >= 10 - 1e-9) {
            predT.push({ t, ...pr });
            for (const q of Object.keys(pr)) if (pr[q] > maxPred[q]) maxPred[q] = pr[q];
          }
        }
      }
    }
    const ka = kawalki(m, dane);
    let akt = 0, pod = 0, grunt = 0, wAkt = 0, wGr = 0;
    const zG2 = maGrunt ? gruntZ + 200 : -Infinity;
    for (let i = nW; i < nW + nD; i++) if (m.aktywny[i]) { akt++; if (m.pos[3 * i + 2] < pos0[3 * i + 2] - 500) pod++; if (m.pos[3 * i + 2] < zG2) grunt++; }
    for (let i = 0; i < nW; i++) if (m.aktywny[i]) { wAkt++; if (m.pos[3 * i + 2] < zG2) wGr++; }
    const P = sumaP();
    const dP = Math.sqrt((P[0] - P0[0]) ** 2 + (P[1] - P0[1]) ** 2 + (P[2] - P0[2]) ** 2) / n;
    const kon = predkosci(m, dane, ka);
    const pr = predT.length ? maxPred : kon;
    // Plan: najwięcej startów na klatkę i pchnięć równocześnie, z danych.
    const naKl = new Map();
    let maxNaKl = 0;
    for (const e of g.kratery) { const v = (naKl.get(e.f) ?? 0) + 1; naKl.set(e.f, v); if (v > maxNaKl) maxNaKl = v; }
    let maxPch = 0;
    for (const e of g.kratery) { let c = 0; for (const q of g.kratery) if (q.f <= e.f && e.f < q.f + Math.max(1, Math.round(q.tau * FPS))) c++; if (c > maxPch) maxPch = c; }
    return {
      miejsce, ziarno, t: Tk, n, nW, nD, nDaktywnych: akt, msKroki, msNaKrok: msKroki / N, odczytow,
      K1: { th0: +th0.toFixed(1), thStyk: +thStyk.toFixed(1), tStyk: +tStyk.toFixed(2), otwor: otworSzczyt, otworPrzed, otwor36 },
      K2: { najw: r3(ka.najw / nD), b64: r3(ka.b64 / nD), b8_63: r3(ka.b8_63 / nD), b1_7: r3(ka.b1_7 / nD), usuniete: r3((nD - akt) / nD), kotwice: r3(ka.kot / nD), ile64: ka.ile64, czystosc: r3(czystoscKawalkow(m, dane, ka)) },
      K3: { pod500: r3(pod / Math.max(1, akt)), przyGruncie: r3(grunt / Math.max(1, akt)), wiezaPrzyGruncie: r3(wGr / Math.max(1, wAkt)), tWiezaGrunt: +tWiezaGrunt.toFixed(2), tDyskGrunt: +tDyskGrunt.toFixed(2), tDuzyGrunt: +tDuzyGrunt.toFixed(2), rozDuzy, tDuzy512: +tDuzy512.toFixed(2), roz512, wiezaPrzy512: r3(wiezaPrzy512) },
      K4: { dPnaN: r3(dP), maxDPnaN: r3(maxDP), maxOdchCom: +maxOdchCom.toFixed(2), medKawalekMasa: +pr.medMasa.toFixed(1), medKawalekBezwag: +pr.medBezwag.toFixed(1), medWezel: +pr.medWezel.toFixed(1), maxKawalek8: +pr.max8.toFixed(1), ileKawalkow8: kon.ile8 },
      K5: { nan, asym, bledyGpu: wok.bledy().length },
      K6: { eksplozjePlan: g.kratery.length, wykonane: solver.liczniki.wykonaneKratery, pominietePchniecia: solver.liczniki.pominietePchniecia, maxNaKlatke: maxNaKl, maxRownoczesnie: maxPch, tPierwsza: g.kratery.length ? +(g.kratery[0].f / FPS).toFixed(2) : -1, tOstatnia: g.kratery.length ? +(g.kratery[g.kratery.length - 1].f / FPS).toFixed(2) : -1, puscKotwiceF: g.puscKotwiceF },
      K7: { drabina: drabina(m, dane), ile64: ka.ile64 },
      hist,
    };
  }

  return { s5, popc };
}
