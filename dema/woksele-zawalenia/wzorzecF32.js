// Wzorzec CPU przebiegu F w arytmetyce f32 (docs/SPEC-woksele-zawalenia.md § 8): każde działanie przez Math.fround, ta sama kolejność działań co kernel kF w solver.js.
// Po co: węzeł, którego siła leży o mniej niż ulp od progu, w f32 idzie inną gałęzią niż w f64 (zm. S2 t = 3: |ft|/lim = 1,0000023), więc migawka z Node w f64 nie jest osiągalna dla żadnego kernela f32.
// Ten wzorzec odróżnia taki przypadek od błędu portu: GPU ma się z nim zgadzać na tych samych progach. Lista kontaktów zostaje z WzorzecCpu (f64), bo komórki i zasięg nie decydują o sile.
// opcje.f32 = false: te same działania bez zaokrąglania, tylko do sprawdzenia, że to ten sam algorytm co WzorzecCpu (tests/wokseleWgsl.test.mjs).
import { WzorzecCpu } from './wzorzec-cpu.js';
import { N0X, N0Y, N0Z, popcnt, gWezla } from '../../src/3d/woksele/budowa.js';

const TOZSAMOSC = (x) => x;

export class WzorzecF32 extends WzorzecCpu {
  constructor(w, par = w.par, { f32 = true } = {}) {
    super(w, par);
    this.F = f32 ? Math.fround : TOZSAMOSC;
  }

  _przebiegF() {
    const F = this.F;
    const {
      n, pos, vel, acc, nbr, L, R0, D, Ft, Fc, iT, iC, maskaW, maskaW2, aktywny, nieruchomy, bezG, kUd, bMax2W, etyk, etyk2, lista, lLicz, M, rk, iN0, kruszTab, klasaW,
      szkoda, szkoda2, rozlewW, szokW, F0, A, A2, aLos, par: p, sFr, sM, skG, h, dx, zr,
    } = this;
    const K = F(this.K), cB = F(this.cB), kB = F(this.kB), kC = F(this.kC), cC = F(this.cC), cT = F(this.cT), cosW = F(this.cosWypieku);
    const uCap = F(this.capEtyk);
    const uSkF0 = F(skG), uSkG = F(skG);
    const uSzokProg = F(p.szokTempo * dx * Math.sqrt(sM));
    const uKontaktV = F(p.kontaktSzokV * Math.sqrt(sM));
    const uLepL = F(p.lepL * sFr), uLepV2 = F((p.lepV * sFr) * (p.lepV * sFr));
    const uGruzP = F(p.gruzPara * sFr), uGruzV2 = F((p.gruzV * sFr) * (p.gruzV * sFr));
    const uFalaV2 = this.rama ? F(p.fala.v * p.fala.v * sFr * sFr) : 1e30;
    const uFalaTempoH = F(Math.min(1, p.fala.tempo * h) * sFr);
    const uPekaProg = F(p.falaPeka.prog), uPekaZakres = F(p.falaPeka.zakres);
    const uZlomB2 = F(p.zlomB * p.zlomB);
    const zG = F(F(this.gruntZ) + F(0.5 * dx));
    const mu = F(p.mu), muG = F(p.muGrunt), oslab = F(p.fala.oslab), aMax = F(p.fala.aMax), prog = F(p.fala.prog);
    const wagaProg = F(p.wagaProg), wagaS = F(p.wagaS), r15 = F(1 + p.rozcHard), r045 = F(p.sciskHard);
    const kB2 = F(kB * 2);
    const gxS = F(F(zr.gx) * uSkG), gyS = F(F(zr.gy) * uSkG), gzS = F(F(zr.gz) * uSkG), zrPole = !!(zr.punkt || zr.obrot);
    const wG = this._wG;
    for (let i = 0; i < n; i++) {
      if (!aktywny[i]) { maskaW2[i] = 0; szkoda2[i] = 1; continue; }
      const o3 = 3 * i;
      const xi = pos[o3], yi = pos[o3 + 1], zi = pos[o3 + 2];
      const vxi = vel[o3], vyi = vel[o3 + 1], vzi = vel[o3 + 2];
      const szI = szkoda[i], aI = A[i], eI = etyk[i];
      const mI = maskaW[i];
      let mNowa = mI;
      let eMin = 65535, szSas = 0, aSas = 0, svx = 0, svy = 0, svz = 0, sn = 0, ax = 0, ay = 0, az = 0;
      const baza = 18 * i;
      for (let d = 0; d < 18; d++) {
        const bit = 1 << d;
        if (!(mI & bit)) continue;
        const ox = baza + d;
        const j = nbr[ox];
        const j3 = 3 * j;
        const dX = F(pos[j3] - xi), dY = F(pos[j3 + 1] - yi), dZ = F(pos[j3 + 2] - zi);
        const r = Math.max(F(Math.sqrt(F(F(F(dX * dX) + F(dY * dY)) + F(dZ * dZ)))), F(1e-4));
        const nx = F(dX / r), ny = F(dY / r), nz = F(dZ / r);
        let Lb = L[ox];
        let f = F(K * F(r - Lb));
        const dmg = D[ox];
        let kap = F(1 - dmg);
        let f0z = F0[ox];
        const f0b = F(f0z * uSkF0);
        const r0 = R0[ox];
        const szJ = szkoda[j], aJ = A[j], eJ = etyk[j];
        if (szJ > szSas) szSas = szJ;
        if (aJ > aSas) aSas = aJ;
        const kl = klasaW[ox];
        if (kl < 4) {
          const aB = aI > aJ ? aI : aJ;
          if (aB > uPekaProg) {
            const lo = i < j ? i : j, hi = i < j ? j : i;
            let hB = Math.imul(lo, 73856093) ^ Math.imul(hi, 19349663);
            hB = Math.imul(hB ^ (hB >>> 13), 0x5bd1e995);
            hB ^= hB >>> 15;
            if (aB > F(uPekaProg + F(F(uPekaZakres * ((hB >>> 0) & 1023)) / 1023))) { mNowa &= ~bit; continue; }
          }
        }
        const kr = kruszTab[kl];
        if (kr > 0) {
          const q = F(1 - F(kr * (szI > szJ ? szI : szJ)));
          kap = F(kap * (q > F(0.03) ? q : F(0.03)));
        }
        if (f0b !== 0) {
          const n0x = F(N0X[d]), n0y = F(N0Y[d]), n0z = F(N0Z[d]);
          const ft = F(f + f0b);
          const limS = F((ft > 0 ? Ft[ox] : Fc[ox]) * kap);
          const cosA = F(F(F(nx * n0x) + F(ny * n0y)) + F(nz * n0z));
          if (cosA < cosW || Math.abs(ft) > limS || (uCap > 0 && (eI > eJ ? eI : eJ) >= uCap)) {
            Lb = F(Lb - F(f0b / K));
            f0z = 0;
            L[ox] = Lb;
            F0[ox] = 0;
            f = F(K * F(r - Lb));
          } else {
            const wx = F(vel[j3] - vxi), wy = F(vel[j3 + 1] - vyi), wz = F(vel[j3 + 2] - vzi);
            svx = F(svx + wx); svy = F(svy + wy); svz = F(svz + wz); sn = F(sn + 1);
            const Fb = F(f + F(cB * F(F(F(wx * nx) + F(wy * ny)) + F(wz * nz))));
            ax = F(ax + F(F(nx * Fb) + F(n0x * f0b))); ay = F(ay + F(F(ny * Fb) + F(n0y * f0b))); az = F(az + F(F(nz * Fb) + F(n0z * f0b)));
            if (eJ < eMin) eMin = eJ;
            continue;
          }
        }
        if (f > 0) {
          const lim = F(Ft[ox] * kap);
          if (f > lim) {
            const nad = F(F(f - lim) / K);
            Lb = F(Lb + nad);
            const dN = F(dmg + F(nad * iT[ox]));
            L[ox] = Lb; D[ox] = dN;
            f = lim;
            if (dN >= 1) { mNowa &= ~bit; continue; }
          }
          if (r > F(r0 * r15)) { mNowa &= ~bit; continue; }
        } else {
          const lim = F(Fc[ox] * kap);
          if (-f > lim) {
            const nad = F(F(-f - lim) / K);
            Lb = F(Lb - nad);
            const dN = F(dmg + F(nad * iC[ox]));
            L[ox] = Lb; D[ox] = dN;
            f = -lim;
            if (dN >= 1) { mNowa &= ~bit; continue; }
          }
          if (r < F(r0 * r045)) { mNowa &= ~bit; continue; }
        }
        const wx = F(vel[j3] - vxi), wy = F(vel[j3 + 1] - vyi), wz = F(vel[j3 + 2] - vzi);
        svx = F(svx + wx); svy = F(svy + wy); svz = F(svz + wz); sn = F(sn + 1);
        const Fb = F(f + F(cB * F(F(F(wx * nx) + F(wy * ny)) + F(wz * nz))));
        ax = F(ax + F(nx * Fb)); ay = F(ay + F(ny * Fb)); az = F(az + F(nz * Fb));
        if (eJ < eMin) eMin = eJ;
      }

      const bMi = bMax2W[i];
      for (let d = 0; d < 6; d++) {
        const bit = 1 << d;
        if (!(mI & bit)) continue;
        const j = nbr[baza + d];
        const j3 = 3 * j;
        const xj = pos[j3], yj = pos[j3 + 1], zj = pos[j3 + 2];
        const mJ = maskaW[j];
        const dp = d ^ 1;
        if (!(mJ & (1 << dp))) mNowa &= ~bit;
        if (mJ & bit) {
          const q3 = 3 * nbr[18 * j + d];
          const bx = F(F(xi + pos[q3]) - F(xj * 2)), by = F(F(yi + pos[q3 + 1]) - F(yj * 2)), bz = F(F(zi + pos[q3 + 2]) - F(zj * 2));
          const b2 = F(F(F(bx * bx) + F(by * by)) + F(bz * bz));
          const bMj = bMax2W[j];
          if (b2 > bMj && b2 <= F(bMj * uZlomB2)) {
            const s = F(kB * F(Math.sqrt(F(bMj / b2))));
            ax = F(ax - F(bx * s)); ay = F(ay - F(by * s)); az = F(az - F(bz * s));
          } else if (b2 > bMj) {
            mNowa &= ~bit;
          } else {
            ax = F(ax - F(bx * kB)); ay = F(ay - F(by * kB)); az = F(az - F(bz * kB));
          }
        }
        if (!(d & 1) && (mI & (1 << dp))) {
          const k3 = 3 * nbr[baza + dp];
          const bx = F(F(xj + pos[k3]) - F(xi * 2)), by = F(F(yj + pos[k3 + 1]) - F(yi * 2)), bz = F(F(zj + pos[k3 + 2]) - F(zi * 2));
          const b2 = F(F(F(bx * bx) + F(by * by)) + F(bz * bz));
          if (b2 > bMi && b2 <= F(bMi * uZlomB2)) {
            const s = F(kB2 * F(Math.sqrt(F(bMi / b2))));
            ax = F(ax + F(bx * s)); ay = F(ay + F(by * s)); az = F(az + F(bz * s));
          } else if (b2 > bMi) {
            mNowa &= ~bit;
            mNowa &= ~(1 << dp);
          } else {
            ax = F(ax + F(bx * kB2)); ay = F(ay + F(by * kB2)); az = F(az + F(bz * kB2));
          }
        }
      }
      maskaW2[i] = mNowa;

      let sN = Math.max(Math.max(F(1 - F(popcnt(mI) * iN0[i])), F(rozlewW[i] * szSas)), szI);
      if (szokW[i] > 0 && sn > 0) {
        const dv = F(F(F(Math.sqrt(F(F(F(svx * svx) + F(svy * svy)) + F(svz * svz)))) / sn) / uSzokProg);
        if (dv > 1) sN = Math.max(sN, Math.min(F(szokW[i] * F(dv - 1)), F(0.95)));
      }
      let aN = aI;
      if (!bezG[i]) {
        const v2 = F(F(F(vxi * vxi) + F(vyi * vyi)) + F(vzi * vzi));
        if (v2 > uFalaV2) {
          const cel = szI > prog ? 1 : F(aSas * oslab);
          if (cel > aN) aN = F(aN + F(F(cel - aN) * uFalaTempoH));
        }
        sN = Math.max(sN, F(F(aN * aLos[i]) * aMax));
      }
      if (nieruchomy[i]) {
        szkoda2[i] = sN; A2[i] = aN; etyk2[i] = 0;
        continue;
      }

      const ile = lLicz[i];
      let udar = 0;
      const bl = i * M;
      const ri = rk[i];
      for (let c = 0; c < ile; c++) {
        const j = lista[bl + c];
        if (!aktywny[j]) continue;
        const j3 = 3 * j;
        const dX = F(pos[j3] - xi), dY = F(pos[j3 + 1] - yi), dZ = F(pos[j3 + 2] - zi);
        const sm = F(ri + rk[j]);
        const r2 = F(F(F(dX * dX) + F(dY * dY)) + F(dZ * dZ));
        if (r2 >= F(sm * sm) || r2 < F(1e-8)) continue;
        const r = F(Math.sqrt(r2));
        const nx = F(dX / r), ny = F(dY / r), nz = F(dZ / r);
        const wx = F(vel[j3] - vxi), wy = F(vel[j3 + 1] - vyi), wz = F(vel[j3 + 2] - vzi);
        const vn = F(F(F(wx * nx) + F(wy * ny)) + F(wz * nz));
        const Fn = F(F(kC * F(sm - r)) - F(cC * vn));
        if (Fn <= 0) continue;
        if (-vn > udar) udar = -vn;
        ax = F(ax - F(nx * Fn)); ay = F(ay - F(ny * Fn)); az = F(az - F(nz * Fn));
        if (F(F(F(wx * wx) + F(wy * wy)) + F(wz * wz)) < uGruzV2) { ax = F(ax + F(wx * uGruzP)); ay = F(ay + F(wy * uGruzP)); az = F(az + F(wz * uGruzP)); }
        const tx = F(wx - F(nx * vn)), ty = F(wy - F(ny * vn)), tz = F(wz - F(nz * vn));
        const vt = F(Math.sqrt(F(F(F(tx * tx) + F(ty * ty)) + F(tz * tz))));
        if (vt > F(1e-3)) {
          const s = F(Math.min(F(Fn * mu), F(cT * vt)) / vt);
          ax = F(ax + F(tx * s)); ay = F(ay + F(ty * s)); az = F(az + F(tz * s));
        }
      }
      if (kUd[i] > 0 && udar > uKontaktV) sN = Math.max(sN, Math.min(F(kUd[i] * F(F(udar / uKontaktV) - 1)), F(0.95)));

      const e = eMin === 65535 ? uCap : Math.min(F(eMin + 1), uCap);
      szkoda2[i] = sN; A2[i] = aN; etyk2[i] = e;

      let gix = gxS, giy = gyS, giz = gzS;
      if (zrPole) { gWezla(zr, xi, yi, zi, vxi, vyi, vzi, wG); gix = F(F(wG[0]) * uSkG); giy = F(F(wG[1]) * uSkG); giz = F(F(wG[2]) * uSkG); }
      if (bezG[i]) {
        if (e >= uCap) { ax = F(ax + gix); ay = F(ay + giy); az = F(az + giz); }
        else if (szI > wagaProg) { const qW = Math.min(F(F(szI - wagaProg) * wagaS), 1); ax = F(ax + F(gix * qW)); ay = F(ay + F(giy * qW)); az = F(az + F(giz * qW)); }
      } else {
        ax = F(ax + gix); ay = F(ay + giy); az = F(az + giz);
      }

      if (zi < zG) {
        const Fg = F(F(kC * F(zG - zi)) - F(cC * vzi));
        if (Fg > 0) {
          az = F(az + Fg);
          if (F(F(F(vxi * vxi) + F(vyi * vyi)) + F(vzi * vzi)) < uGruzV2) { ax = F(ax - F(vxi * uGruzP)); ay = F(ay - F(vyi * uGruzP)); az = F(az - F(vzi * uGruzP)); }
          const vt = F(Math.sqrt(F(F(vxi * vxi) + F(vyi * vyi))));
          if (vt > F(1e-3)) {
            const s = F(Math.min(F(Fg * muG), F(cT * vt)) / vt);
            ax = F(ax - F(vxi * s)); ay = F(ay - F(vyi * s));
          }
        }
      }
      if (eI < uCap && F(F(F(vxi * vxi) + F(vyi * vyi)) + F(vzi * vzi)) < uLepV2) { ax = F(ax - F(vxi * uLepL)); ay = F(ay - F(vyi * uLepL)); az = F(az - F(vzi * uLepL)); }
      acc[o3] = ax; acc[o3 + 1] = ay; acc[o3 + 2] = az;
    }
    this.maskaW = maskaW2;
    this.maskaW2 = maskaW;
    this.etyk = etyk2;
    this.etyk2 = etyk;
    this.szkoda = szkoda2;
    this.szkoda2 = szkoda;
    this.A = A2;
    this.A2 = A;
  }
}
