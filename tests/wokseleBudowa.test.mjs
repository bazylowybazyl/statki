// Budowa dema wiązanych wokseli (docs/SPEC-woksele-zawalenia.md § 2.3, § 9): bajt w bajt z prototypu, grawitacja, zdarzenia przez przebiegi.
// Skróty SHA-256 (24 znaki) policzone z proby4/model-spec4.mjs przy parametrach końcowych (parametry-spec4.json + nKom 65 536), wpisane jako stałe,
// bo .tmp/ nie ma w repo. O przechyle wieży decyduje budowa (§ 1.2), więc inne bajty to inna wieża, a nie szum.
// Długie przebiegi i zgodność całych scen: node scripts/woksele-sym.mjs. Test bez pomiaru ściany.
// node --test tests/wokseleBudowa.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { S1, S2, S3, S4, wieza, dysk } from '../dema/woksele-zawalenia/scena.js';
import { zbuduj, parametry, popcnt } from '../dema/woksele-zawalenia/budowa.js';
import { WzorzecCpu, pakujMigawke, rozpakujMigawke } from '../dema/woksele-zawalenia/wzorzec-cpu.js';
import { porownajPodkrok, analizaPolowek } from '../dema/woksele-zawalenia/metryki.js';

const WZOR = {
  S1: {
    liczby: { n: 14942, capEtyk: 109, K: 30000, h: 0.0020833333333333333, cB: 34.64101615137755, kB: 3000, kC: 24000, cC: 76.68115805072325, cT: 76.68115805072325, sFr: 1, sM: 1, rama: true, zasieg: 29.799869537353516, iKom: 0.03355719389128603, nKom: 65536, iter: 1770, maxF0: 86207.7310162637 },
    pola: {
      pos: '953cc0b7baa13fd3326cbb19',
      kind: 'aefb42ebe8da9bf925e57738',
      ijk: 'bcad915ab71615c175bffe1a',
      grupa: '1e5648b593065bbddc42debf',
      vel0: 'e99b39f3cf3250fe1ae65e47',
      nbr: 'cd63d2ff3eae46a88210e5f9',
      R0: '26a4d9bf20b01b661420eea1',
      L: '26a4d9bf20b01b661420eea1',
      F0: 'bbe04d09c6b41b228fe5edb0',
      f0: 'bbe04d09c6b41b228fe5edb0',
      Ft: 'ae6291cb973b5855e2c309b1',
      Fc: '1cfc7bef92a17af38f865967',
      iT: '5c4b89f89750561d589aec4c',
      iC: 'b083fccc546c9b783a7be42b',
      klasaW: 'f34bbdb9135f9c21d4c0333f',
      maska: '48d0fc9baccb0aa8b89191a7',
      iN0: 'e52981e5e6f0fdd4fcf73758',
      aLos: '36a3b88e6623880972301ac9',
      rozlewW: 'cad3af1598a8af9c3acef07b',
      szokW: '42faa5d5a3d0a36c5fc3ae2b',
      kUd: 'd77be4ee0b38e8f94da802c0',
      bMax2W: '6747b696706b8d011d97c17f',
      rk: 'c9014ffa29a38bfa347eb7ed',
      etyk: 'fdc6cfaf7e8719d0d87f7e2c',
      bezG: '1e5648b593065bbddc42debf',
      nieruchomy: 'f48dc9202fb4e39ec1dc7ae9',
      ziarnoW: '3bd1a71323f403ab84957253',
      flagi: '6262ac140865ec4b0db71a22',
      kruszTab: '56c8847b7fb1d468f2c027aa',
    },
  },
  S3: {
    liczby: { n: 20622, capEtyk: 55, K: 30000, h: 0.0020833333333333333, cB: 34.64101615137755, kB: 3000, kC: 24000, cC: 76.68115805072325, cT: 76.68115805072325, sFr: 0.806225774829855, sM: 1, rama: true, zasieg: 29.799869537353516, iKom: 0.03355719389128603, nKom: 65536, iter: 5236, maxF0: 49797.56524646189 },
    pola: {
      pos: 'c68398006655bf8075ab81a5',
      kind: 'e1f23c2744c956addc7baacc',
      ijk: '00281602568e4a67a84be302',
      grupa: '2f327527e3720b2cf93252f2',
      vel0: '660394fe26173f49c1cb2705',
      nbr: 'c16840124f7597e7ba693743',
      R0: '54e0ad55ede4aafa9f3cfaf8',
      L: '809dad7464569e358d28d714',
      F0: '55778f69a21d3938e77f3237',
      f0: 'c70a20f0e163c0e317b204eb',
      Ft: '59cd8cc814a877d502e76323',
      Fc: '93a57cb872ac1bd3d56f7e8e',
      iT: 'eca2ec554d08f9a50f4382c3',
      iC: '5717b92083ba6b763309c3c2',
      klasaW: '645e68c9aa613c9b07902a7f',
      maska: 'fa681a717f5f24e77deb2647',
      iN0: '501d2789e3d15f45de8feaf7',
      aLos: '7725b5ce766f6dc3baaa9de4',
      rozlewW: 'e1e2317111fc573d493d29b3',
      szokW: 'b2af6c7d3671308144d07e37',
      kUd: '6a91364bc9cd8d91cf124d84',
      bMax2W: 'db23048926a01ee8117f075a',
      rk: '717b4afc950eee81fccff61c',
      etyk: '41b70eb0f46cc3f8cf94cf1c',
      bezG: '2f327527e3720b2cf93252f2',
      nieruchomy: '4ae5d8f11477f363492abf3a',
      ziarnoW: 'a87f99f94772dff6893eabcd',
      flagi: '204a275c40eb599ea946b363',
      kruszTab: '56c8847b7fb1d468f2c027aa',
    },
  },
  S4: {
    liczby: { n: 14942, capEtyk: 0, K: 30000, h: 0.0020833333333333333, cB: 34.64101615137755, kB: 3000, kC: 24000, cC: 76.68115805072325, cT: 76.68115805072325, sFr: 0, sM: 1, rama: false, zasieg: 29.799869537353516, iKom: 0.03355719389128603, nKom: 65536, iter: 1770, maxF0: 86207.7310162637 },
    pola: {
      pos: '953cc0b7baa13fd3326cbb19',
      kind: 'aefb42ebe8da9bf925e57738',
      ijk: 'bcad915ab71615c175bffe1a',
      grupa: '1e5648b593065bbddc42debf',
      vel0: 'e99b39f3cf3250fe1ae65e47',
      nbr: 'cd63d2ff3eae46a88210e5f9',
      R0: '26a4d9bf20b01b661420eea1',
      L: '26a4d9bf20b01b661420eea1',
      F0: '767022c4cef42d9fb16f7141',
      f0: 'bbe04d09c6b41b228fe5edb0',
      Ft: 'ae6291cb973b5855e2c309b1',
      Fc: '1cfc7bef92a17af38f865967',
      iT: '5c4b89f89750561d589aec4c',
      iC: 'b083fccc546c9b783a7be42b',
      klasaW: 'f34bbdb9135f9c21d4c0333f',
      maska: '48d0fc9baccb0aa8b89191a7',
      iN0: 'e52981e5e6f0fdd4fcf73758',
      aLos: '36a3b88e6623880972301ac9',
      rozlewW: 'cad3af1598a8af9c3acef07b',
      szokW: '42faa5d5a3d0a36c5fc3ae2b',
      kUd: 'd77be4ee0b38e8f94da802c0',
      bMax2W: '6747b696706b8d011d97c17f',
      rk: 'c9014ffa29a38bfa347eb7ed',
      etyk: 'c4eaf26d27e838c1a57122e0',
      bezG: '1e5648b593065bbddc42debf',
      nieruchomy: '1e5648b593065bbddc42debf',
      ziarnoW: '3bd1a71323f403ab84957253',
      flagi: 'c412c41e2165c2d7406c9155',
      kruszTab: '56c8847b7fb1d468f2c027aa',
    },
  },
};

const skrot = (t) => createHash('sha256').update(Buffer.from(t.buffer, t.byteOffset, t.byteLength)).digest('hex').slice(0, 24);
const bajty = (t) => Buffer.from(t.buffer, t.byteOffset, t.byteLength);
const pamiecStatyki = new Map(); // S1, S2 i S4 to ta sama wieża: statyka projektu liczy się raz
const buduj = (plan, par) => zbuduj(plan.scena, par, { pamiecStatyki });

function polaWypieku(w) {
  return {
    pos: w.pos, kind: w.kind, ijk: w.ijk, grupa: w.grupa, vel0: w.vel0 ?? new Float32Array(3 * w.n), nbr: w.nbr, R0: w.R0, L: w.L, F0: w.F0, f0: w.f0,
    Ft: w.Ft, Fc: w.Fc, iT: w.iT, iC: w.iC, klasaW: w.klasaW, maska: w.maska, iN0: w.iN0, aLos: w.aLos, rozlewW: w.rozlewW, szokW: w.szokW, kUd: w.kUd,
    bMax2W: w.bMax2W, rk: w.rk, etyk: w.etyk, bezG: w.bezG, nieruchomy: w.nieruchomy, ziarnoW: w.ziarnoW, flagi: w.flagi, kruszTab: w.kruszTab,
  };
}

function sprawdzWzor(nazwa, plan) {
  const w = buduj(plan);
  const wz = WZOR[nazwa];
  const pola = polaWypieku(w);
  assert.deepEqual(Object.keys(pola).sort(), Object.keys(wz.pola).sort(), `${nazwa}: lista pól`);
  for (const k of Object.keys(pola)) assert.equal(skrot(pola[k]), wz.pola[k], `${nazwa}: pole ${k} różni się od model-spec4`);
  for (const k of ['n', 'capEtyk', 'K', 'h', 'cB', 'kB', 'kC', 'cC', 'cT', 'sFr', 'sM', 'rama', 'zasieg', 'iKom', 'nKom']) assert.equal(w[k], wz.liczby[k], `${nazwa}: ${k}`);
  assert.equal(w.info.grupy.wieza.iter, wz.liczby.iter, `${nazwa}: iteracje CG`);
  assert.equal(w.info.grupy.wieza.maxF0, wz.liczby.maxF0, `${nazwa}: największa siła statyczna`);
  return w;
}

test('budowa S1 bajt w bajt z model-spec4', () => { sprawdzWzor('S1', S1()); });
test('budowa S3 bajt w bajt z model-spec4', () => { sprawdzWzor('S3', S3()); });
test('budowa S4 bajt w bajt z model-spec4', () => { sprawdzWzor('S4', S4()); });

test('geometria: liczby węzłów z § 3', () => {
  const w = wieza();
  assert.equal(w.n, 14942);
  assert.deepEqual(w.meta.liczby, { strop: 8040, kolumna: 4280, fasada: 1014, rdzen: 1608, dysk: 0, kotwica: 0 });
  assert.equal(w.meta.h, 1340);
  const d = dysk({ R: 900, grubosc: 80, zSrodek: 0 });
  assert.equal(d.n, 17382);
  assert.equal(d.meta.liczby.dysk, 15766);
  assert.equal(d.meta.liczby.kotwica, 1616);
  assert.equal(S3().scena.n, 20622);
});

test('miejsce nie zmienia materiału: S1 i S4 mają te same wytrzymałości, różnią się kotwice i sprężenie', () => {
  const a = buduj(S1()), b = buduj(S4());
  for (const k of ['Ft', 'Fc', 'L', 'R0', 'klasaW', 'bMax2W', 'aLos', 'rk', 'nbr', 'f0']) assert.ok(bajty(a[k]).equals(bajty(b[k])), `pole ${k}`);
  assert.ok(a.F0.some((x) => x !== 0), 'S1 ma sprężenie');
  assert.ok(a.nieruchomy.some((x) => x), 'S1 ma kotwice');
});

test('bez kotwic: F0 = 0, nikt nie stoi, brak etykiety', () => {
  const w = buduj(S4());
  assert.ok(w.F0.every((x) => x === 0));
  assert.ok(w.nieruchomy.every((x) => x === 0));
  assert.ok(w.flagi.every((x) => (x & 1) === 0));
  assert.equal(w.capEtyk, 0);
  assert.equal(w.rama, false);
  assert.ok(w.f0.some((x) => x !== 0), 'f0 dalej liczy wytrzymałości');
});

test('gProj = 0 daje zera bez NaN', () => {
  const w = zbuduj(S4({ gProj: 0 }).scena);
  assert.equal(w.info.grupy.wieza.iter, 0);
  assert.ok(w.f0.every((x) => x === 0), 'f0');
  assert.ok(w.F0.every((x) => x === 0), 'F0');
  for (const k of ['Ft', 'Fc', 'L', 'R0', 'bMax2W']) assert.ok(w[k].every((x) => Number.isFinite(x)), `${k} bez NaN`);
  const naWiazaniach = w.Ft.filter((x, i) => w.nbr[i] >= 0);
  assert.ok(naWiazaniach.every((x) => x > 0), 'wytrzymałości z minimum eMin');
});

test('S4 od razu: suma pędu zbioru kopu 0, moment odjęty, kop nie jest zerem', () => {
  const plan = S4();
  const m = new WzorzecCpu(buduj(plan));
  const grupa = plan.blasty.map((b) => ({ x: b.x, y: b.y, z: b.z, rP: 320, Jk: 120 / (0.8 * 60) }));
  const trafione = m.pchniecia(grupa, true);
  assert.ok(trafione > 1000, `trafione ${trafione}`);
  let px = 0, py = 0, pz = 0, vm = 0;
  for (let i = 0; i < m.n; i++) {
    px += m.vel[3 * i]; py += m.vel[3 * i + 1]; pz += m.vel[3 * i + 2];
    vm = Math.max(vm, Math.sqrt(m.vel[3 * i] ** 2 + m.vel[3 * i + 1] ** 2 + m.vel[3 * i + 2] ** 2));
  }
  assert.ok(vm > 0.5, `kop ${vm}`);
  const P = Math.sqrt(px * px + py * py + pz * pz) / m.n;
  assert.ok(P < 1e-4, `|P|/N ${P}`);
  const a = analizaPolowek(m, plan.scena.pos, plan.zc, 120);
  const L = Math.sqrt(a.L[0] ** 2 + a.L[1] ** 2 + a.L[2] ** 2);
  assert.ok(L / a.N < 1e-1, `|L|/N ${L / a.N}`);
});

// Zdarzenia przez przebiegi jak na GPU (§ 2.8): kCzas oznacza S = 2 / 3 i martwe, kCzysc czyści własne bity, kCzyscS sprowadza S do 1.
class PrzezPrzebieg extends WzorzecCpu {
  usun(l) { this.oznaczUsun(l); this.czeka = true; }
  rozerwij(l, z) { this.oznaczRozerwij(l, z); this.czeka = true; }
  krok() {
    if (this.czeka) { this.czeka = false; this.przebiegCzysc(); }
    super.krok();
  }
}

function porownajKlatki(plan, odF, ile) {
  const w = buduj(plan);
  const a = new WzorzecCpu(w), b = new PrzezPrzebieg(w);
  for (let f = odF; f < odF + ile; f++) {
    plan.zdarzenia(f, a);
    plan.zdarzenia(f, b);
    a.krok();
    b.krok();
    for (const k of ['pos', 'vel', 'maskaW', 'L', 'D', 'F0', 'aktywny']) assert.ok(bajty(a[k]).equals(bajty(b[k])), `klatka ${f}: pole ${k}`);
    for (let i = 0; i < a.n; i++) {
      if (a.aktywny[i] && a.szkoda[i] !== b.szkoda[i]) assert.fail(`klatka ${f}: S węzła ${i}: ${a.szkoda[i]} kontra ${b.szkoda[i]}`);
    }
  }
  assert.ok(a.zerwanych > 0, 'zdarzenia coś zerwały');
  assert.equal(a.zerwanych, b.zerwanych);
  return a;
}

test('kCzysc bit w bit: S4, rozerwanie z zostawieniem ziaren (S = 3) i pchnięcia', () => {
  const a = porownajKlatki(S4(), 120, 24);
  let rozerwane = 0;
  for (let i = 0; i < a.n; i++) if (popcnt(a.maskaW[i]) !== popcnt(a.w.maska[i])) rozerwane++;
  assert.ok(rozerwane > 100, `węzły po cięciu ${rozerwane}`);
});

test('kCzysc bit w bit: S2, front usunięć i rozerwań (S = 2)', () => {
  const a = porownajKlatki(S2(), 120, 24);
  assert.ok(a.aktywny.some((x) => !x), 'są martwe');
});

test('migawka: zapis i odczyt dają ten sam podkrok, a porównanie widzi zmianę', () => {
  const plan = S4();
  const w = buduj(plan);
  const m = new WzorzecCpu(w);
  for (let f = 120; f < 132; f++) { plan.zdarzenia(f, m); m.krok(); }
  const przed = m.migawka();
  const k1 = new WzorzecCpu(w);
  k1.wgraj(przed);
  k1.podkrokPorownania();
  const po = k1.stanPoPodkroku();
  const { naglowek, bajty: plik } = pakujMigawke({ scena: 'S4', f: 132, skG: przed.skG, sFr: przed.sFr, kotwiceWiezy: przed.kotwiceWiezy }, { przed, po });
  const wcz = rozpakujMigawke(JSON.parse(JSON.stringify(naglowek)), plik.buffer);
  const k2 = new WzorzecCpu(w);
  k2.wgraj({ ...wcz.przed, skG: wcz.skG, sFr: wcz.sFr, kotwiceWiezy: wcz.kotwiceWiezy });
  k2.podkrokPorownania();
  const wynik = k2.stanPoPodkroku();
  const r = porownajPodkrok(wcz.po, wynik, przed.aktywny, przed.nieruchomy, { prog: 0, progA: 0 });
  assert.equal(r.zaliczony, true, JSON.stringify(r));
  // Zerwane wiązanie i zmieniona siła muszą być widoczne.
  const zmien = { ...wynik, maskaW: wynik.maskaW.slice(), acc: wynik.acc.slice() };
  const i = przed.aktywny.indexOf(1);
  zmien.maskaW[i] ^= 1;
  zmien.acc[3 * i] += 100;
  const r2 = porownajPodkrok(wcz.po, zmien, przed.aktywny, przed.nieruchomy);
  assert.equal(r2.maski, 1);
  assert.equal(r2.zaliczony, false);
});

test('parametry końcowe z § 2.1 i nakładka ziarna', () => {
  const w = buduj(S1());
  assert.equal(w.podkrokiEf, 8);
  assert.equal(w.K, 30000);
  assert.equal(w.kB, 3000);
  assert.equal(w.kC, 24000);
  assert.equal(w.M, 32);
  assert.equal(w.S, 16);
  assert.equal(w.nKom, 65536);
  assert.equal(w.capEtyk, 109);
  const inna = zbuduj(S1().scena, parametry({ ziarno: 21 }), { pamiecStatyki });
  assert.notEqual(skrot(inna.Ft), skrot(w.Ft), 'inne ziarno, inna budowa');
});

test('moduły dema bez window, DOM, three, Math.random i Math.hypot (§ 9)', () => {
  for (const plik of ['scena', 'budowa', 'wzorzec-cpu', 'metryki']) {
    const kod = readFileSync(new URL(`../dema/woksele-zawalenia/${plik}.js`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    for (const zakazane of [/\bwindow\b/, /\bdocument\b/, /from\s+['"]three/, /Math\.random/, /Math\.hypot/, /\bglobalThis\b/]) {
      assert.ok(!zakazane.test(kod), `${plik}.js: ${zakazane}`);
    }
  }
});
