// Wzorzec CPU solvera wiązanych wokseli (docs/SPEC-woksele-zawalenia.md § 2.4–2.8, § 8): to samo, co kernele GPU, w JS.
// Port `model-spec4.mjs` bez gałęzi wyłączonych przez parametry końcowe (§ 2.1). Wynik jest bit w bit jak model-spec4
// (scripts/woksele-sym.mjs --zgodnosc), a solver GPU porównuje się z nim węzeł po węźle z migawek (§ 8).
// Moduł czysty: bez three, DOM i window. Oba końce wiązania liczą to samo z tych samych danych z poprzedniego przebiegu,
// więc zerwanie jest symetryczne bez zapisu do cudzego węzła. Kolejność sprawdzeń przy wiązaniu ma znaczenie (§ 2.5): nie zmieniać.
import { ND, STRONA, N0X, N0Y, N0Z, PARAMETRY, gWezla, popcnt } from './budowa.js';

/** Pola stanu w migawce (§ 8): to, co zmienia się w biegu. Reszta wynika z budowy sceny o tym samym ziarnie. */
export const POLA_MIGAWKI = Object.freeze(['pos', 'vel', 'acc', 'L', 'D', 'F0', 'maskaW', 'szkoda', 'A', 'etyk', 'aktywny', 'nieruchomy']);

/**
 * Opis budowy do nagłówka migawki: liczby, które odróżniają wypieki o tym samym n i ziarnie, i skrót FNV-1a po słowach Ft, L, F0 i maski.
 * Bez node:crypto, bo z tego samego korzysta strona testu GPU.
 */
export function budowaMigawki(w) {
  let h = 0x811c9dc5;
  for (const t of [w.Ft, w.L, w.F0, w.maska]) {
    const slowa = new Uint32Array(t.buffer, t.byteOffset, t.byteLength >>> 2);
    for (let i = 0; i < slowa.length; i++) h = Math.imul(h ^ slowa[i], 16777619);
  }
  return { n: w.n, gProj: w.gProj, capEtyk: w.capEtyk, nKom: w.nKom, K: w.K, skrot: (h >>> 0).toString(16).padStart(8, '0') };
}

/** Rzuca błąd, gdy migawka pochodzi z innej budowy niż `w` albo nie ma jej opisu. */
export function sprawdzBudowe(budowa, w) {
  const tu = budowaMigawki(w);
  for (const k of Object.keys(tu)) {
    if (budowa?.[k] !== tu[k]) throw new Error(`Migawka z innej budowy: ${k} = ${budowa?.[k]}, a scena ma ${tu[k]}`);
  }
}

export class WzorzecCpu {
  constructor(w, par = w.par ?? PARAMETRY) {
    this.w = w;
    this.par = par;
    const { n } = w;
    Object.assign(this, {
      n,
      dx: w.dx, h: w.h, podkrokiEf: w.podkrokiEf, K: w.K, sM: w.sM, sFr: w.sFr,
      cB: w.cB, kB: w.kB, kC: w.kC, cC: w.cC, cT: w.cT, cosWypieku: w.cosWypieku,
      gruntZ: w.gruntZ, zr: w.zr, gProj: w.gProj, rama: w.rama, kotwiceWiezy: w.kotwiceWiezy, capEtyk: w.capEtyk, info: w.info,
      kind: w.kind, ijk: w.ijk, grupa: w.grupa,
      nbr: w.nbr, R0: w.R0, Ft: w.Ft, Fc: w.Fc, iT: w.iT, iC: w.iC, klasaW: w.klasaW,
      iN0: w.iN0, aLos: w.aLos, rozlewW: w.rozlewW, szokW: w.szokW, kUd: w.kUd, bMax2W: w.bMax2W, rk: w.rk, bezG: w.bezG, ziarnoW: w.ziarnoW,
      zasieg: w.zasieg, iKom: w.iKom, M: w.M, S: w.S, nKom: w.nKom, lutKier: w.lutKier, kruszTab: w.kruszTab,
      wa: w.wa, wb: w.wb, wd: w.wd, mW: w.mW,
    });
    this.skG = 1; // skala grawitacji w biegu (F0 jedzie razem z g)
    this.pos = w.pos.slice();
    this.vel = w.vel0 ? w.vel0.slice() : new Float32Array(3 * n);
    this.acc = new Float32Array(3 * n);
    this.aktywny = new Uint8Array(n).fill(1);
    this.nieruchomy = w.nieruchomy.slice();
    this.L = w.L.slice();
    this.D = new Float32Array(STRONA * n);
    this.F0 = w.F0.slice();
    this.maskaW = w.maska.slice();
    this.maskaW2 = w.maska.slice();
    this.szkoda = new Float32Array(n);
    this.szkoda2 = new Float32Array(n);
    this.A = new Float32Array(n);
    this.A2 = new Float32Array(n);
    this.etyk = w.etyk.slice();
    this.etyk2 = w.etyk.slice();
    // Lista kontaktów
    this.licz = new Int32Array(this.nKom);
    this.sloty = new Int32Array(this.nKom * this.S);
    this.ci = new Int32Array(n);
    this.cj = new Int32Array(n);
    this.ck = new Int32Array(n);
    this.lista = new Int32Array(n * this.M);
    this.lLicz = new Uint8Array(n);
    // Liczniki
    this.kroki = 0;
    this.nPrzebudow = 0;
    this.zerwanych = 0;
    this.zerwanychZginaniem = 0;
    this.plast = 0;
    this.vmaxOstatni = 0;
    this.przepelnienia = 0;
    this.kontaktowOst = 0;
    this.maxKontaktow = 0;
    this.maxKomorka = 0;
    this.przepelnieniaKomorek = 0;
    this.kandydaci = 0;
    this._wG = [0, 0, 0];
    this._wAkt = null;
    this._indW = null;
    this._dvW = null;
  }

  /** Jeden krok fizyki 1/60 s: lista co `rytmListy` podkroków, F, I (§ 2.4). */
  krok() {
    // AGENT: wzorzec liczy tylko dx = 20 bez skali budynku. Przy innym dx albo par.skalaBud GPU ma rytmEf i progi z √s (ustawUniformy w solver.js), tu ich nie ma.
    const rytm = this.par.rytmListy;
    for (let s = 0; s < this.podkrokiEf; s++) {
      if (s % rytm === 0) this._przebudujListe();
      this._przebiegF();
      this._przebiegI();
      this.kroki++;
    }
  }

  skalaG(s) {
    this.skG = s;
    this.sFr = Math.sqrt((this.zr.gMod * s) / 400);
  }

  /**
   * Kotwice puszczają. Bez gruntu: swobodny spadek, naprężeń nie ma, więc F0 po prostu znika.
   * Na gruncie: F0 zostaje, a etykieta rośnie i wypieka je sama, grunt przejmuje reakcję (nie działa, R15, poza demem).
   */
  odkotwicz(naGruncie = false) {
    if (!naGruncie) this.F0.fill(0);
    this.nieruchomy.fill(0);
    this.kotwiceWiezy = false;
  }

  /** Usunięcie: węzeł martwy, sąsiedzi tracą wiązania od razu (na GPU: kCzas + kCzysc, § 2.8; wzór przebiegu niżej). */
  usun(lista) {
    const { nbr, aktywny, vel } = this;
    const mA = this.maskaW, mB = this.maskaW2;
    for (let q = 0; q < lista.length; q++) {
      const i = lista[q];
      if (!aktywny[i]) continue;
      aktywny[i] = 0;
      for (let d = 0; d < ND; d++) {
        const j = nbr[STRONA * i + d];
        if (j < 0) continue;
        mA[j] &= ~(1 << (d ^ 1));
        mB[j] &= ~(1 << (d ^ 1));
      }
      mA[i] = 0;
      mB[i] = 0;
      vel[3 * i] = vel[3 * i + 1] = vel[3 * i + 2] = 0;
    }
  }

  /**
   * Rozerwanie: węzeł żyje i niesie pęd, wszystkie jego wiązania znikają po obu stronach, szkoda 1.
   * zostawZiarna: wiązania wewnątrz ziarna przeżywają, więc lecą kawałki płyt i słupów, nie pojedyncze węzły.
   */
  rozerwij(lista, zostawZiarna = false) {
    const { nbr, aktywny, klasaW } = this;
    const mA = this.maskaW, mB = this.maskaW2;
    for (let q = 0; q < lista.length; q++) {
      const i = lista[q];
      if (!aktywny[i]) continue;
      for (let d = 0; d < ND; d++) {
        if (!((mA[i] >>> d) & 1)) continue;
        if (zostawZiarna && klasaW[STRONA * i + d] >= 6) continue;
        const j = nbr[STRONA * i + d];
        mA[j] &= ~(1 << (d ^ 1));
        mB[j] &= ~(1 << (d ^ 1));
        mA[i] &= ~(1 << d);
        mB[i] &= ~(1 << d);
      }
      this.szkoda[i] = 1;
      this.szkoda2[i] = 1;
    }
  }

  // Zdarzenia przez przebiegi jak na GPU (§ 2.8): kCzas oznacza, kCzysc czyści WŁASNE bity każdego węzła, kCzyscS sprowadza S do ≤ 1.
  // Wynik bit w bit jak usun + rozerwij (strażnik tests/wokseleBudowa.test.mjs). Bez cudzych zapisów.

  oznaczUsun(lista) {
    const { aktywny, vel } = this;
    for (let q = 0; q < lista.length; q++) {
      const i = lista[q];
      if (!aktywny[i]) continue;
      aktywny[i] = 0;
      this.maskaW[i] = 0;
      this.maskaW2[i] = 0;
      vel[3 * i] = vel[3 * i + 1] = vel[3 * i + 2] = 0;
    }
  }

  /** S = 2: traci wszystkie wiązania; S = 3: zostawia wiązania wewnątrz ziarna. */
  oznaczRozerwij(lista, zostawZiarna = false) {
    const { aktywny, szkoda } = this;
    const znak = zostawZiarna ? 3 : 2;
    for (let q = 0; q < lista.length; q++) {
      const i = lista[q];
      if (aktywny[i]) szkoda[i] = znak;
    }
  }

  przebiegCzysc() {
    const { n, nbr, aktywny, klasaW, szkoda, szkoda2 } = this;
    const mA = this.maskaW, mB = this.maskaW2;
    for (let i = 0; i < n; i++) {
      if (!aktywny[i]) continue;
      const sI = szkoda[i];
      let m = mA[i], w = m;
      while (m) {
        const bit = m & -m;
        m ^= bit;
        const d = 31 - Math.clz32(bit);
        const ox = STRONA * i + d;
        const j = nbr[ox];
        const sJ = szkoda[j];
        if (!aktywny[j] || sJ === 2 || sI === 2 || ((sJ === 3 || sI === 3) && klasaW[ox] < 6)) w &= ~bit;
      }
      mB[i] = w;
    }
    for (let i = 0; i < n; i++) {
      if (!aktywny[i]) continue;
      mA[i] = mB[i];
      if (szkoda[i] > 1) { szkoda[i] = 1; szkoda2[i] = 1; }
    }
  }

  /**
   * Pchnięcie radialne (§ 2.8): Δv = Jk·(1 − r/rP)·r̂ na żywych węzłach w zasięgu, z zerową sumą pędu (odjęta średnia zbioru)
   * i opcjonalnie momentu (odjęty sztywny obrót zbioru). Wszystkie węzły mają tę samą masę.
   * grupa: tablica { x, y, z, rP, Jk } aktywnych w tej klatce; wspólna zerowa suma.
   */
  pchniecia(grupa, zerujL = false) {
    const { n, pos, vel, aktywny, nieruchomy } = this;
    const ind = this._indW ?? (this._indW = new Int32Array(n));
    const dv = this._dvW ?? (this._dvW = new Float64Array(3 * n));
    let m = 0, px = 0, py = 0, pz = 0, sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < n; i++) {
      if (!aktywny[i] || nieruchomy[i]) continue;
      let ax = 0, ay = 0, az = 0, tr = false;
      for (let b = 0; b < grupa.length; b++) {
        const q = grupa[b];
        const X = pos[3 * i] - q.x, Y = pos[3 * i + 1] - q.y, Z = pos[3 * i + 2] - q.z;
        const r2 = X * X + Y * Y + Z * Z;
        if (r2 >= q.rP * q.rP) continue;
        const r = Math.sqrt(r2) + 1e-6;
        const a = (q.Jk * (1 - r / q.rP)) / r;
        ax += a * X; ay += a * Y; az += a * Z; tr = true;
      }
      if (!tr) continue;
      dv[3 * m] = ax; dv[3 * m + 1] = ay; dv[3 * m + 2] = az;
      ind[m++] = i;
      px += ax; py += ay; pz += az;
      sx += pos[3 * i]; sy += pos[3 * i + 1]; sz += pos[3 * i + 2];
    }
    if (m === 0) return 0;
    const im = 1 / m;
    px *= im; py *= im; pz *= im; sx *= im; sy *= im; sz *= im;
    let wx = 0, wy = 0, wz = 0;
    if (zerujL) {
      let Lx = 0, Ly = 0, Lz = 0, Ixx = 0, Iyy = 0, Izz = 0, Ixy = 0, Ixz = 0, Iyz = 0;
      for (let q = 0; q < m; q++) {
        const i = ind[q];
        const X = pos[3 * i] - sx, Y = pos[3 * i + 1] - sy, Z = pos[3 * i + 2] - sz;
        const ax = dv[3 * q] - px, ay = dv[3 * q + 1] - py, az = dv[3 * q + 2] - pz;
        Lx += Y * az - Z * ay; Ly += Z * ax - X * az; Lz += X * ay - Y * ax;
        Ixx += Y * Y + Z * Z; Iyy += X * X + Z * Z; Izz += X * X + Y * Y;
        Ixy -= X * Y; Ixz -= X * Z; Iyz -= Y * Z;
      }
      const A = Iyy * Izz - Iyz * Iyz, B = Ixz * Iyz - Ixy * Izz, C = Ixy * Iyz - Ixz * Iyy;
      const det = Ixx * A + Ixy * B + Ixz * C;
      if (Math.abs(det) > 1e-6) {
        const E = Ixx * Izz - Ixz * Ixz, F = Ixy * Ixz - Ixx * Iyz, H = Ixx * Iyy - Ixy * Ixy;
        wx = (A * Lx + B * Ly + C * Lz) / det; wy = (B * Lx + E * Ly + F * Lz) / det; wz = (C * Lx + F * Ly + H * Lz) / det;
      }
    }
    for (let q = 0; q < m; q++) {
      const i = ind[q];
      const X = pos[3 * i] - sx, Y = pos[3 * i + 1] - sy, Z = pos[3 * i + 2] - sz;
      vel[3 * i] += dv[3 * q] - px - (wy * Z - wz * Y);
      vel[3 * i + 1] += dv[3 * q + 1] - py - (wz * X - wx * Z);
      vel[3 * i + 2] += dv[3 * q + 2] - pz - (wx * Y - wy * X);
    }
    return m;
  }

  /** kWstaw + kLista (§ 2.7): siatka mieszająca o stałych slotach, potem lista per węzeł. */
  _przebudujListe() {
    const { n, pos, licz, sloty, S, iKom, ci, cj, ck, lista, lLicz, M, nKom, aktywny, maskaW, zasieg, ijk, grupa, lutKier } = this;
    const mk = nKom - 1;
    licz.fill(0);
    for (let i = 0; i < n; i++) {
      if (!aktywny[i]) continue;
      const a = Math.floor(pos[3 * i] * iKom), b = Math.floor(pos[3 * i + 1] * iKom), c = Math.floor(pos[3 * i + 2] * iKom);
      ci[i] = a; cj[i] = b; ck[i] = c;
      const h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) & mk;
      const q = licz[h]++;
      if (q < S) sloty[h * S + q] = i;
      else this.przepelnieniaKomorek++;
    }
    const z2 = zasieg * zasieg;
    let wsz = 0, prz = 0, maxL = 0;
    for (let i = 0; i < n; i++) {
      if (!aktywny[i]) { lLicz[i] = 0; continue; }
      const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
      const a = ci[i], b = cj[i], c = ck[i];
      const gi = grupa[i];
      const mI = maskaW[i];
      let l = 0;
      const baza = i * M;
      for (let dc = -1; dc <= 1; dc++) for (let db = -1; db <= 1; db++) for (let da = -1; da <= 1; da++) {
        const A = a + da, B = b + db, C = c + dc;
        const h = (Math.imul(A, 73856093) ^ Math.imul(B, 19349663) ^ Math.imul(C, 83492791)) & mk;
        const ile = licz[h];
        if (ile === 0) continue;
        const kon = ile < S ? ile : S;
        for (let q = 0; q < kon; q++) {
          const j = sloty[h * S + q];
          if (j === i || ci[j] !== A || cj[j] !== B || ck[j] !== C) continue;
          const dX = pos[3 * j] - x, dY = pos[3 * j + 1] - y, dZ = pos[3 * j + 2] - z;
          if (dX * dX + dY * dY + dZ * dZ >= z2) continue;
          if (grupa[j] === gi) {
            const di = ijk[3 * j] - ijk[3 * i], dj = ijk[3 * j + 1] - ijk[3 * i + 1], dk = ijk[3 * j + 2] - ijk[3 * i + 2];
            if (di >= -1 && di <= 1 && dj >= -1 && dj <= 1 && dk >= -1 && dk <= 1) {
              const d = lutKier[(dk + 1) * 9 + (dj + 1) * 3 + di + 1];
              if (d >= 0 && (mI >>> d) & 1) continue; // żywe wiązanie wyłącza kontakt
            }
          }
          if (l < M) lista[baza + l++] = j;
          else prz++;
        }
      }
      lLicz[i] = l;
      wsz += l;
      if (l > maxL) maxL = l;
    }
    this.kontaktowOst = wsz;
    this.przepelnienia += prz;
    if (maxL > this.maxKontaktow) this.maxKontaktow = maxL;
    let maxK = 0;
    for (let c = 0; c < nKom; c++) if (licz[c] > maxK) maxK = licz[c];
    if (maxK > this.maxKomorka) this.maxKomorka = maxK;
    this.nPrzebudow++;
  }

  /** Kernel F (§ 2.5): gather sił, czyta stan sprzed przebiegu, pisze swoje kopie. */
  _przebiegF() {
    const {
      n, pos, vel, acc, nbr, L, R0, D, Ft, Fc, iT, iC, maskaW, maskaW2, aktywny, nieruchomy, bezG, kUd,
      K, cB, kB, bMax2W, etyk, etyk2, capEtyk, lista, lLicz, M, rk, kC, cC, cT, gruntZ, dx, iN0, kruszTab, klasaW,
      szkoda, szkoda2, rozlewW, szokW, F0, cosWypieku: cosWyp, A, A2, aLos, par: p, sFr, sM, skG, h,
    } = this;
    const iProgSzok = 1 / (p.szokTempo * dx * Math.sqrt(sM));
    const kontaktSzokV = p.kontaktSzokV * Math.sqrt(sM);
    const gruzV2 = (p.gruzV * sFr) * (p.gruzV * sFr);
    const gruzP = p.gruzPara * sFr;
    const lepL = p.lepL * sFr, lepV2 = (p.lepV * sFr) * (p.lepV * sFr);
    const fpProg = p.falaPeka.prog, fpZakres = p.falaPeka.zakres;
    const fala = p.fala;
    const falaV2 = this.rama ? fala.v * fala.v * sFr * sFr : 1e30; // bez ramy fala milczy (§ 10.3)
    const tempoH = Math.min(1, fala.tempo * h);
    const zrc = this.zr, gxS = zrc.gx * skG, gyS = zrc.gy * skG, gzS = zrc.gz * skG, zrPole = !!(zrc.punkt || zrc.obrot);
    const wG = this._wG;
    const wagaS = p.wagaS, wagaProg = p.wagaProg;
    const zlomB2 = p.zlomB * p.zlomB;
    const rozcHard = p.rozcHard, sciskHard = p.sciskHard;
    const mu = p.mu, muG = p.muGrunt;
    const iK = 1 / K;
    const zG = gruntZ + 0.5 * dx;
    let zerwanych = 0, zGiecie = 0, plast = 0;
    for (let i = 0; i < n; i++) {
      if (!aktywny[i]) { maskaW2[i] = 0; szkoda2[i] = 1; continue; }
      const stoi = nieruchomy[i];
      const o3 = 3 * i;
      const xi = pos[o3], yi = pos[o3 + 1], zi = pos[o3 + 2];
      const vxi = vel[o3], vyi = vel[o3 + 1], vzi = vel[o3 + 2];
      let ax = 0, ay = 0, az = 0;
      const mI = maskaW[i];
      let mNowa = mI;
      let eMin = 65535;
      let m = mI;
      const baza = STRONA * i;
      const szI = szkoda[i];
      let szSas = 0;
      let svx = 0, svy = 0, svz = 0, sn = 0;
      let aSas = 0;
      while (m) {
        const bit = m & -m;
        m ^= bit;
        const d = 31 - Math.clz32(bit);
        const ox = baza + d;
        const j = nbr[ox];
        const j3 = 3 * j;
        const dX = pos[j3] - xi, dY = pos[j3 + 1] - yi, dZ = pos[j3 + 2] - zi;
        const r = Math.sqrt(dX * dX + dY * dY + dZ * dZ);
        const iR = 1 / r;
        const nx = dX * iR, ny = dY * iR, nz = dZ * iR;
        let Lb = L[ox];
        let f = K * (r - Lb);
        const dmg = D[ox];
        let kap = 1 - dmg;
        const f0b = F0[ox] * skG;
        const szJ = szkoda[j];
        if (szJ > szSas) szSas = szJ;
        if (A[j] > aSas) aSas = A[j];
        if (klasaW[ox] < 4) {
          // Fala łamie granicę ziaren: próg z hasha PARY, A obu końców ze stanu sprzed przebiegu, więc zerwanie symetryczne.
          const aB = A[i] > A[j] ? A[i] : A[j];
          if (aB > fpProg) {
            const lo = i < j ? i : j, hi = i < j ? j : i;
            let hB = Math.imul(lo, 73856093) ^ Math.imul(hi, 19349663);
            hB = Math.imul(hB ^ (hB >>> 13), 0x5bd1e995);
            hB ^= hB >>> 15;
            if (aB > fpProg + fpZakres * ((hB >>> 0) % 1024) / 1023) { mNowa &= ~bit; zerwanych++; continue; }
          }
        }
        const kr = kruszTab[klasaW[ox]];
        if (kr > 0) {
          const q = 1 - kr * (szI > szJ ? szI : szJ);
          kap *= q > 0.03 ? q : 0.03;
        }
        if (f0b !== 0) {
          // Sprężenie martwe: siła wzdłuż kierunku projektowego. Wypiek przy uplastycznieniu, obrocie wiązania albo oderwaniu od kotwicy.
          const cosA = nx * N0X[d] + ny * N0Y[d] + nz * N0Z[d];
          const ft = f + f0b;
          const limS = ft > 0 ? Ft[ox] * kap : Fc[ox] * kap;
          if (cosA < cosWyp || (ft > 0 ? ft : -ft) > limS || (capEtyk && (etyk[i] >= capEtyk || etyk[j] >= capEtyk))) {
            Lb -= f0b * iK;
            L[ox] = Lb;
            F0[ox] = 0;
            f = K * (r - Lb);
          } else {
            const wxB = vel[j3] - vxi, wyB = vel[j3 + 1] - vyi, wzB = vel[j3 + 2] - vzi;
            svx += wxB; svy += wyB; svz += wzB; sn++;
            const vn = wxB * nx + wyB * ny + wzB * nz;
            const Fb = f + cB * vn;
            ax += Fb * nx + f0b * N0X[d]; ay += Fb * ny + f0b * N0Y[d]; az += Fb * nz + f0b * N0Z[d];
            const e = etyk[j];
            if (e < eMin) eMin = e;
            continue;
          }
        }
        if (f > 0) {
          const lim = Ft[ox] * kap;
          if (f > lim) {
            const nad = (f - lim) * iK;
            Lb += nad;
            const dN = dmg + nad * iT[ox];
            L[ox] = Lb;
            D[ox] = dN;
            f = lim;
            plast++;
            if (dN >= 1) { mNowa &= ~bit; zerwanych++; continue; }
          }
          if (r > R0[ox] * (1 + rozcHard)) { mNowa &= ~bit; zerwanych++; continue; }
        } else {
          const lim = Fc[ox] * kap;
          if (-f > lim) {
            const nad = (-f - lim) * iK;
            Lb -= nad;
            const dN = dmg + nad * iC[ox];
            L[ox] = Lb;
            D[ox] = dN;
            f = -lim;
            plast++;
            if (dN >= 1) { mNowa &= ~bit; zerwanych++; continue; }
          }
          if (r < R0[ox] * sciskHard) { mNowa &= ~bit; zerwanych++; continue; }
        }
        const wxB = vel[j3] - vxi, wyB = vel[j3 + 1] - vyi, wzB = vel[j3 + 2] - vzi;
        svx += wxB; svy += wyB; svz += wzB; sn++;
        const vn = wxB * nx + wyB * ny + wzB * nz;
        const Fb = f + cB * vn;
        ax += Fb * nx; ay += Fb * ny; az += Fb * nz;
        const e = etyk[j];
        if (e < eMin) eMin = e;
      }

      // Zginanie: linie osiowe, energia (kB/2)|x_a + x_b − 2 x_srodek|². Środek +2 kB b, końce −kB b. Pięciopunktowo, więc pęd zachowany.
      for (let d = 0; d < 6; d++) {
        if (!((mI >>> d) & 1)) continue;
        const j = nbr[baza + d];
        const j3 = 3 * j;
        // i jest końcem, środek w j, drugi koniec jj.
        if ((maskaW[j] >>> d) & 1) {
          const jj = nbr[STRONA * j + d];
          const q3 = 3 * jj;
          const bx = xi + pos[q3] - 2 * pos[j3], by = yi + pos[q3 + 1] - 2 * pos[j3 + 1], bz = zi + pos[q3 + 2] - 2 * pos[j3 + 2];
          const b2 = bx * bx + by * by + bz * bz;
          if (b2 > bMax2W[j] && b2 <= bMax2W[j] * zlomB2) {
            const sk = Math.sqrt(bMax2W[j] / b2);
            ax -= kB * sk * bx; ay -= kB * sk * by; az -= kB * sk * bz;
          } else if (b2 > bMax2W[j]) {
            if (mNowa & (1 << d)) { mNowa &= ~(1 << d); zerwanych++; zGiecie++; }
          } else {
            ax -= kB * bx; ay -= kB * by; az -= kB * bz;
          }
        }
        // i jest środkiem: raz na oś (d parzyste), drugi koniec w d ^ 1.
        if (!(d & 1) && ((mI >>> (d ^ 1)) & 1)) {
          const k = nbr[baza + (d ^ 1)];
          const k3 = 3 * k;
          const bx = pos[j3] + pos[k3] - 2 * xi, by = pos[j3 + 1] + pos[k3 + 1] - 2 * yi, bz = pos[j3 + 2] + pos[k3 + 2] - 2 * zi;
          const b2 = bx * bx + by * by + bz * bz;
          if (b2 > bMax2W[i] && b2 <= bMax2W[i] * zlomB2) {
            const sk = Math.sqrt(bMax2W[i] / b2);
            const w = 2 * kB * sk;
            ax += w * bx; ay += w * by; az += w * bz;
          } else if (b2 > bMax2W[i]) {
            if (mNowa & (1 << d)) { mNowa &= ~(1 << d); zerwanych++; zGiecie++; }
            if (mNowa & (1 << (d ^ 1))) { mNowa &= ~(1 << (d ^ 1)); zerwanych++; zGiecie++; }
          } else {
            const w = 2 * kB;
            ax += w * bx; ay += w * by; az += w * bz;
          }
        }
      }

      maskaW2[i] = mNowa;
      {
        const wl = 1 - popcnt(mI) * iN0[i];
        const roz = rozlewW[i] * szSas;
        let sN = wl > roz ? wl : roz;
        if (szI > sN) sN = szI;
        const sk = szokW[i];
        if (sk > 0 && sn > 0) {
          const iS = 1 / sn;
          const dv = Math.sqrt(svx * svx + svy * svy + svz * svz) * iS * iProgSzok;
          if (dv > 1) {
            const sz = sk * (dv - 1);
            const ogr = sz < 0.95 ? sz : 0.95;
            if (ogr > sN) sN = ogr;
          }
        }
        if (!bezG[i]) { // dysk poza falą: fala + waga od szkody rozsypywały pokład
          const v2 = vxi * vxi + vyi * vyi + vzi * vzi;
          let a = A[i];
          if (v2 > falaV2) {
            const cel = szI > fala.prog ? 1 : aSas * fala.oslab;
            if (cel > a) a += (cel - a) * tempoH * sFr;
          }
          A2[i] = a;
          const sA = a * aLos[i] * fala.aMax;
          if (sA > sN) sN = sA;
        }
        szkoda2[i] = sN;
      }
      if (stoi) continue; // kotwica i fundament liczą tylko swoje kopie stanu wiązań

      // Kontakty.
      const ile = lLicz[i];
      let udar = 0;
      if (ile) {
        const bl = i * M;
        const ri = rk[i];
        for (let c = 0; c < ile; c++) {
          const j = lista[bl + c];
          if (!aktywny[j]) continue;
          const j3 = 3 * j;
          const dX = pos[j3] - xi, dY = pos[j3 + 1] - yi, dZ = pos[j3 + 2] - zi;
          const sm = ri + rk[j];
          const r2 = dX * dX + dY * dY + dZ * dZ;
          if (r2 >= sm * sm || r2 < 1e-8) continue;
          const r = Math.sqrt(r2);
          const iR = 1 / r;
          const nx = dX * iR, ny = dY * iR, nz = dZ * iR;
          const wx = vel[j3] - vxi, wy = vel[j3 + 1] - vyi, wz = vel[j3 + 2] - vzi;
          const vn = wx * nx + wy * ny + wz * nz;
          const Fn = kC * (sm - r) - cC * vn;
          if (Fn <= 0) continue;
          if (-vn > udar) udar = -vn;
          ax -= Fn * nx; ay -= Fn * ny; az -= Fn * nz;
          // Zakleszczenie PARY: względem partnera, pęd zachowany.
          if (wx * wx + wy * wy + wz * wz < gruzV2) { ax += gruzP * wx; ay += gruzP * wy; az += gruzP * wz; }
          // Tarcie: regularyzowany Coulomb, bez pamięci.
          const tx = wx - vn * nx, ty = wy - vn * ny, tz = wz - vn * nz;
          const vt = Math.sqrt(tx * tx + ty * ty + tz * tz);
          if (vt > 1e-3) {
            const Ftr = Math.min(mu * Fn, cT * vt) / vt;
            ax += Ftr * tx; ay += Ftr * ty; az += Ftr * tz;
          }
        }
      }

      if (kUd[i] > 0 && udar > kontaktSzokV) {
        const su = kUd[i] * (udar / kontaktSzokV - 1);
        const ogr = su < 0.95 ? su : 0.95;
        if (ogr > szkoda2[i]) szkoda2[i] = ogr;
      }

      // Grawitacja. Etykieta tylko przy kotwicach (capEtyk > 0); bez nich węzły zostają przy etykiecie z budowy, a nic jej nie czyta.
      let gix = gxS, giy = gyS, giz = gzS;
      if (zrPole) { gWezla(zrc, xi, yi, zi, vxi, vyi, vzi, wG); gix = wG[0] * skG; giy = wG[1] * skG; giz = wG[2] * skG; }
      if (capEtyk) {
        const e = eMin === 65535 ? capEtyk : (eMin + 1 < capEtyk ? eMin + 1 : capEtyk);
        etyk2[i] = e;
      }
      if (bezG[i]) {
        const e = etyk2[i];
        if (e >= capEtyk) { ax += gix; ay += giy; az += giz; }
        else if (szI > wagaProg) { const sW2 = (szI - wagaProg) * wagaS; const qW = sW2 < 1 ? sW2 : 1; ax += gix * qW; ay += giy * qW; az += giz * qW; }
      } else {
        ax += gix; ay += giy; az += giz;
      }

      // Grunt.
      if (zi < zG) {
        const gl = zG - zi;
        const Fn = kC * gl - cC * vzi;
        if (Fn > 0) {
          az += Fn;
          if (vxi * vxi + vyi * vyi + vzi * vzi < gruzV2) { ax -= gruzP * vxi; ay -= gruzP * vyi; az -= gruzP * vzi; }
          const vt = Math.sqrt(vxi * vxi + vyi * vyi);
          if (vt > 1e-3) {
            const Ftr = Math.min(muG * Fn, cT * vt) / vt;
            ax -= Ftr * vxi; ay -= Ftr * vyi;
          }
        }
      }

      // Lepkość spoczynkowa: tylko z żywą drogą do kotwicy (etykieta sprzed przebiegu).
      if (etyk[i] < capEtyk) {
        const v2 = vxi * vxi + vyi * vyi + vzi * vzi;
        if (v2 < lepV2) { ax -= lepL * vxi; ay -= lepL * vyi; az -= lepL * vzi; }
      }

      acc[o3] = ax; acc[o3 + 1] = ay; acc[o3 + 2] = az;
    }
    // Zamiana buforów: wszyscy czytali stan sprzed przebiegu.
    this.maskaW = maskaW2;
    this.maskaW2 = maskaW;
    this.etyk = etyk2;
    this.etyk2 = etyk;
    this.szkoda = szkoda2;
    this.szkoda2 = szkoda;
    this.A = A2;
    this.A2 = A;
    this.zerwanych += zerwanych;
    this.zerwanychZginaniem += zGiecie;
    this.plast += plast;
  }

  /** Kernel I (§ 2.6): półjawny Euler. */
  _przebiegI() {
    const { n, pos, vel, acc, aktywny, nieruchomy, h } = this;
    const vMax2 = this.par.vMax * this.par.vMax;
    let v2m = 0;
    for (let i = 0; i < n; i++) {
      if (!aktywny[i] || nieruchomy[i]) continue;
      const k = 3 * i;
      let vx = vel[k] + acc[k] * h, vy = vel[k + 1] + acc[k + 1] * h, vz = vel[k + 2] + acc[k + 2] * h;
      let v2 = vx * vx + vy * vy + vz * vz;
      if (v2 > vMax2) {
        const s = Math.sqrt(vMax2 / v2);
        vx *= s; vy *= s; vz *= s;
        v2 = vMax2;
      }
      if (v2 > v2m) v2m = v2;
      vel[k] = vx; vel[k + 1] = vy; vel[k + 2] = vz;
      pos[k] += vx * h; pos[k + 1] += vy * h; pos[k + 2] += vz * h;
    }
    this.vmaxOstatni = Math.sqrt(v2m);
  }

  /** Lista wiązań z bieżącą maską: wejście metryk kawałków. */
  wiazania() {
    const { wa, wd, mW, maskaW } = this;
    const wAkt = this._wAkt ?? (this._wAkt = new Uint8Array(mW));
    for (let e = 0; e < mW; e++) wAkt[e] = (maskaW[wa[e]] >>> wd[e]) & 1;
    return { a: wa, b: this.wb, m: mW, aktywne: wAkt };
  }

  statystyki() {
    return {
      kroki: this.kroki,
      zerwanych: this.zerwanych,
      zerwanychZginaniem: this.zerwanychZginaniem,
      plast: this.plast,
      vmax: Math.round(this.vmaxOstatni),
      przebudow: this.nPrzebudow,
      kontakty: this.kontaktowOst,
      przepelnienia: this.przepelnienia,
      maxKontaktow: this.maxKontaktow,
      maxKomorka: this.maxKomorka,
      przepelnieniaKomorek: this.przepelnieniaKomorek,
    };
  }

  /** Kontrola symetrii kopii: obie strony wiązania mają tę samą maskę i stan. */
  sprawdzSymetrie() {
    const { n, nbr, maskaW, L } = this;
    let bledyMaski = 0, bledyL = 0, maksL = 0;
    for (let i = 0; i < n; i++) {
      for (let d = 0; d < ND; d++) {
        const j = nbr[STRONA * i + d];
        if (j < 0) continue;
        const a = (maskaW[i] >>> d) & 1, b = (maskaW[j] >>> (d ^ 1)) & 1;
        if (a !== b) bledyMaski++;
        if (a && b) {
          const q = Math.abs(L[STRONA * i + d] - L[STRONA * j + (d ^ 1)]);
          if (q > 1e-4) bledyL++;
          if (q > maksL) maksL = q;
        }
      }
    }
    return { bledyMaski, bledyL, maksL };
  }

  /** Migawka stanu dla testu jednego podkroku (§ 8): kopie tablic z POLA_MIGAWKI i opis budowy, z której pochodzi. */
  migawka() {
    const m = { skG: this.skG, sFr: this.sFr, kotwiceWiezy: this.kotwiceWiezy, budowa: budowaMigawki(this.w) };
    for (const k of POLA_MIGAWKI) m[k] = this[k].slice();
    return m;
  }

  /**
   * Wgranie migawki: stan jak w chwili jej zrobienia, liczniki bez zmian. Bufory drugie równe pierwszym: przebieg F i tak je nadpisuje.
   * Migawka innej budowy rzuca błąd: S3 przy gProj 400 i 260 ma to samo n i to samo ziarno, a inne K (§ 1.6).
   */
  wgraj(m) {
    sprawdzBudowe(m.budowa, this.w);
    for (const k of POLA_MIGAWKI) this[k].set(m[k]);
    this.maskaW2.set(this.maskaW);
    this.szkoda2.set(this.szkoda);
    this.A2.set(this.A);
    this.etyk2.set(this.etyk);
    this.skG = m.skG;
    this.sFr = m.sFr;
    this.kotwiceWiezy = m.kotwiceWiezy;
  }

  /** Jeden przebieg kLista + kF bez całkowania: to, co porównuje test GPU (maski, S, A, L, D, a). */
  podkrokPorownania() {
    this._przebudujListe();
    this._przebiegF();
  }

  /** Stan po podkrokPorownania w układzie pól „po” migawki (§ 8). */
  stanPoPodkroku() {
    return { maskaW: this.maskaW.slice(), szkoda: this.szkoda.slice(), A: this.A.slice(), etyk: this.etyk.slice(), L: this.L.slice(), D: this.D.slice(), F0: this.F0.slice(), acc: this.acc.slice(), lLicz: this.lLicz.slice(), lista: this.lista.slice() };
  }
}

const TYPY_TABLIC = { Float32Array, Uint32Array, Int32Array, Uint16Array, Uint8Array };

/**
 * Migawka do pliku: { naglowek, bajty }. czesci = { przed: {...tablice}, po: {...tablice} }, meta = pola zwykłe nagłówka.
 * Układ: tablice jedna za drugą, każda wyrównana do 4 bajtów; w nagłówku typ, przesunięcie i długość.
 */
export function pakujMigawke(meta, czesci) {
  const tablice = {};
  let off = 0;
  for (const [czesc, pola] of Object.entries(czesci)) {
    for (const [nazwa, t] of Object.entries(pola)) {
      if (!ArrayBuffer.isView(t)) continue;
      off = (off + 3) & ~3;
      tablice[`${czesc}.${nazwa}`] = { typ: t.constructor.name, przesuniecie: off, dlugosc: t.length };
      off += t.byteLength;
    }
  }
  const bajty = new Uint8Array(off);
  for (const [czesc, pola] of Object.entries(czesci)) {
    for (const [nazwa, t] of Object.entries(pola)) {
      if (!ArrayBuffer.isView(t)) continue;
      bajty.set(new Uint8Array(t.buffer, t.byteOffset, t.byteLength), tablice[`${czesc}.${nazwa}`].przesuniecie);
    }
  }
  return { naglowek: { ...meta, rozmiar: off, tablice }, bajty };
}

/** Odwrotność pakujMigawke: { ...meta, przed: {...}, po: {...} } (widoki na `bufor`, ArrayBuffer). Bez fs: działa też na stronie. */
export function rozpakujMigawke(naglowek, bufor) {
  const { tablice, ...reszta } = naglowek;
  const w = { ...reszta, przed: {}, po: {} };
  for (const [klucz, o] of Object.entries(tablice)) {
    const [czesc, nazwa] = klucz.split('.');
    w[czesc][nazwa] = new TYPY_TABLIC[o.typ](bufor, o.przesuniecie, o.dlugosc);
  }
  return w;
}
