// Wzorzec dema wiązanych wokseli (docs/SPEC-woksele-zawalenia.md § 2.3, § 8, § 9, § 12): budowa bajt w bajt, stan po krótkich biegach bit w bit, parametry, migawki, progi testu jednego podkroku.
// Skróty SHA-256 (24 znaki) i liczniki policzone z proby4/model-spec4.mjs przy parametrach końcowych (parametry-spec4.json + nKom 65 536), wpisane jako stałe, bo .tmp/ nie ma w repo:
// budowa .tmp/woksele-demo/skroty-spec4.mjs, biegi i parametry .tmp/woksele-demo/skroty-biegi-spec4.mjs. O przechyle wieży decyduje budowa (§ 1.2), więc inne bajty to inna wieża, a nie szum.
// Względem tego wzorca liczony jest solver GPU, więc zmiana fizyki musi wywrócić ten test. Biegi w wątkach roboczych: tests/helpers/wokseleBiegi.mjs.
// Długie przebiegi i zgodność całych scen: node scripts/woksele-sym.mjs. Test bez pomiaru ściany.
// node --test tests/wokseleBudowa.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { S1, S3, S4, wieza, dysk } from '../dema/woksele-zawalenia/scena.js';
import { zbuduj, parametry, PARAMETRY } from '../dema/woksele-zawalenia/budowa.js';
import { WzorzecCpu } from '../dema/woksele-zawalenia/wzorzec-cpu.js';
import { porownajPodkrok, analizaPolowek } from '../dema/woksele-zawalenia/metryki.js';
import { BIEGI, POLA_STANU, skrot, uruchomBiegi } from './helpers/wokseleBiegi.mjs';

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

const WZOR_PARAMETROW = {
  c: 6000,
  podkroki: 8,
  zeta: 0.1,
  beta: 0.1,
  zlomGiecia: 0.25,
  zlomB: 2.5,
  kKontakt: 0.8,
  rKontakt: 0.9,
  rJitter: 0.1,
  zetaKontakt: 0.35,
  mu: 0.9,
  cTarcie: 1,
  muGrunt: 0.7,
  skorKontakt: 0.5,
  slotyListy: 32,
  slotyKomorki: 16,
  nKom: 65536,
  rytmListy: 4,
  vMax: 4000,
  rozcHard: 0.5,
  sciskHard: 0.45,
  katWypieku: 12,
  szokTempo: 1.5,
  szokWsp: 0.5,
  kontaktSzokV: 120,
  zapasMin: 2.2,
  zapasDyskPrez: 1.25,
  obwodSlabszy: 0.35,
  dyskSprezenie: 0.005,
  kotwicaWzmocnienie: 3,
  kotwicaZasieg: 6,
  plama: { rozmiar: 4, sila: 0.5 },
  gruzPara: 27,
  gruzV: 30,
  lepL: 10,
  lepV: 25,
  wagaS: 1.5,
  wagaProg: 0.4,
  fala: { v: 60, tempo: 9, aMax: 0.6, prog: 0.5, oslab: 0.999 },
  falaPeka: { prog: 0.25, zakres: 0.5 },
  ziarno: 7,
  kalibracja: { tol: 1e-8, maxIter: 20000, reg: 1e-9 },
  kLin: { strop: 1, kolumna: 1, fasada: 0.02, rdzen: 0.5, dysk: 1, kotwica: 1 },
  klasy: { strop: { SF: 2.8, eMin: 0.0007, rozc: 0.6, dT: 0.05, dC: 0.1, rozrzut: 0.25, krusz: 0.8, rozlew: 0.5, kontaktSzok: 0.5 }, kolumna: { SF: 2.8, eMin: 0.002, rozc: 0.8, dT: 0.15, dC: 0.1, rozrzut: 0.2, krusz: 1, rozlew: 0.6, szok: 1, kontaktSzok: 0.5 }, fasada: { SF: 2.8, eMin: 0.001, rozc: 0.8, dT: 0.15, dC: 0.1, rozrzut: 0.3, krusz: 0.8, rozlew: 0.5, kontaktSzok: 0.5 }, rdzen: { SF: 2.8, eMin: 0.002, rozc: 0.6, dT: 0.08, dC: 0.1, rozrzut: 0.25, krusz: 0.8, rozlew: 0.5, kontaktSzok: 0.5 }, dysk: { SF: 1, eMin: 0.03, rozc: 1, dT: 0.05, dC: 0.1, rozrzut: 0.35, krusz: 1.2, rozlew: 0.82, zlom: 0.12, szok: 3, kontaktSzok: 1 }, kotwica: { SF: 1, eMin: 0.2, rozc: 1, dT: 0.3, dC: 0.3, rozrzut: 0, krusz: 0 } },
  ziarna: { strop: [7, 7, 99], dach: [4, 4, 99], kolumna: [99, 99, 6], fasada: [3, 3, 6], rdzen: [6, 6, 6], dysk: [4, 4, 99], wewn: 6, granica: 0.7, kruszWewn: 0, zlomWewn: 3, waga: 0.5, kl: { dysk: { wewn: 1.5, granica: 1, kruszWewn: 0.6 } } },
};
const WZOR_BIEGOW = {
  S3: {
    liczniki: { zerwanych: 11468, zerwanychZginaniem: 94, plast: 925004, przepelnienia: 0, maxKontaktow: 17, maxKomorka: 19, przepelnieniaKomorek: 55, kontaktowOst: 8678, nPrzebudow: 120, kroki: 480 },
    pola: { pos: 'b4202ff08698c7393a944671', vel: '693f98eeef31701ff49605e4', acc: '4808f8b35382b3c57fcab955', maskaW: 'da6a52d8bc9e8bd7c17d57c4', szkoda: 'ba79b091583f7aeabc3bcfdc', A: 'b6ef6e81f014790f8186d308', etyk: '28b4f7c3c6bfa80630719b21', aktywny: '9b1fddd5df5cb16f125a7687', nieruchomy: '4ae5d8f11477f363492abf3a', L: '9be7ea7f0e77a2350ae2a01b', D: 'c1d29a25919cd13288fe73fb', F0: '55778f69a21d3938e77f3237' },
  },
  S1: {
    liczniki: { zerwanych: 8738, zerwanychZginaniem: 4, plast: 1313874, przepelnienia: 0, maxKontaktow: 15, maxKomorka: 20, przepelnieniaKomorek: 85, kontaktowOst: 6034, nPrzebudow: 120, kroki: 480 },
    pola: { pos: 'd854aff31bd9d88dba70551b', vel: 'a02cb6031298af1d75cb59b9', acc: 'fc797578e0361e2375946dec', maskaW: '8a433610e08a59d2680c07f4', szkoda: '0451f6909c5f7cff64045bd5', A: '321836bcb3df67f1ba6e1d7a', etyk: '279222dbae9b501362d9a6f7', aktywny: '2f05469cfa4a37dc8c4e406f', nieruchomy: 'f48dc9202fb4e39ec1dc7ae9', L: '42bbca07d6618bdcb61ba1e9', D: '0c4778db7751cd6dec02d8a2', F0: 'd62f3ee34f31cf94843a3558' },
  },
  S4: {
    liczniki: { zerwanych: 646, zerwanychZginaniem: 0, plast: 586176, przepelnienia: 0, maxKontaktow: 14, maxKomorka: 20, przepelnieniaKomorek: 65, kontaktowOst: 2754, nPrzebudow: 120, kroki: 480 },
    pola: { pos: 'a3a6c47d02f78bae0f4c7924', vel: 'ed31765e3cc00f8a70203872', acc: '93330929f78b807a0884a87e', maskaW: '4c30c40b5290b30e1931eb4f', szkoda: '36bcb81a71017d74534eff65', A: 'a0855442af39a394a7c96a4e', etyk: 'c4eaf26d27e838c1a57122e0', aktywny: '73ed9d6b8210e3092f90d54f', nieruchomy: '1e5648b593065bbddc42debf', L: '2583afe5225325e3f440aec5', D: '38a88d781750e89ff9fd2169', F0: '767022c4cef42d9fb16f7141' },
  },
  S2: {
    liczniki: { zerwanych: 5530, zerwanychZginaniem: 0, plast: 1345700, przepelnienia: 0, maxKontaktow: 17, maxKomorka: 20, przepelnieniaKomorek: 16, kontaktowOst: 7588, nPrzebudow: 80, kroki: 320 },
    pola: { pos: '38fb23a0fe49e3198c178434', vel: '3d536c9e0e1114cf233e6309', acc: '6e08e4eef1ee25cd3ba05a45', maskaW: '7a42b1ed0071880363ace440', szkoda: '3913464c5dcc6e6b2150a3b3', A: 'c0de510a3bdeb3082dc18326', etyk: 'c11c2e50ddce02994535ac80', aktywny: '8f177e1aa78b891e864901a9', nieruchomy: 'f48dc9202fb4e39ec1dc7ae9', L: '00dfb7068310798657412be9', D: '2ce8da1faab5f15a3e5bbb67', F0: '381c23db4685380a4acafe31' },
  },
  S4obrot: {
    liczniki: { zerwanych: 0, zerwanychZginaniem: 0, plast: 26412, przepelnienia: 0, maxKontaktow: 12, maxKomorka: 16, przepelnieniaKomorek: 0, kontaktowOst: 1030, nPrzebudow: 24, kroki: 96 },
    pola: { pos: '030d61df294d37206e1cad95', vel: '8d365cb5c5ec2e5d9b378570', acc: 'af9a3ff3c8749b92728ed8ae', maskaW: 'df78487fa942bec27843d57a', szkoda: 'd60662ca92ec2a3effe29f47', A: 'a0855442af39a394a7c96a4e', etyk: 'c4eaf26d27e838c1a57122e0', aktywny: '73ed9d6b8210e3092f90d54f', nieruchomy: '1e5648b593065bbddc42debf', L: '82c2f3a56c0a2d3f7c6aa547', D: 'ce6f2db91a2e16d5b1fb95cb', F0: '767022c4cef42d9fb16f7141' },
  },
  S4punkt: {
    liczniki: { zerwanych: 0, zerwanychZginaniem: 0, plast: 10342, przepelnienia: 0, maxKontaktow: 12, maxKomorka: 16, przepelnieniaKomorek: 0, kontaktowOst: 1032, nPrzebudow: 24, kroki: 96 },
    pola: { pos: '7a7c803d7150b9b74cf50571', vel: '46629f7461f6dbb7e503a9bb', acc: '7fae184369c1e65daebb0068', maskaW: 'df78487fa942bec27843d57a', szkoda: 'd60662ca92ec2a3effe29f47', A: 'a0855442af39a394a7c96a4e', etyk: 'c4eaf26d27e838c1a57122e0', aktywny: '73ed9d6b8210e3092f90d54f', nieruchomy: '1e5648b593065bbddc42debf', L: '545b1aa1c6d406edc1aabba0', D: 'ece1809e07342b72e30aa133', F0: '767022c4cef42d9fb16f7141' },
  },
  S4rampa: {
    liczniki: { zerwanych: 0, zerwanychZginaniem: 0, plast: 10876, przepelnienia: 0, maxKontaktow: 12, maxKomorka: 16, przepelnieniaKomorek: 0, kontaktowOst: 1034, nPrzebudow: 24, kroki: 96 },
    pola: { pos: 'b6ab7214806960db963c063d', vel: '966773cb29a31536549e6fe9', acc: '8bdebfb01924d95683ec1ad3', maskaW: 'df78487fa942bec27843d57a', szkoda: 'd60662ca92ec2a3effe29f47', A: '52bac5687ca9d7d2962f8709', etyk: '58cbff2d984f4dd06da46db2', aktywny: '73ed9d6b8210e3092f90d54f', nieruchomy: 'f48dc9202fb4e39ec1dc7ae9', L: 'ef1996e9d0fcbe67cb81c373', D: '58a13516cb0ad9e01069bc90', F0: 'd1ab311378463d7288ce1060' },
  },
  S4grunt: {
    liczniki: { zerwanych: 38, zerwanychZginaniem: 0, plast: 155502, przepelnienia: 0, maxKontaktow: 12, maxKomorka: 18, przepelnieniaKomorek: 18, kontaktowOst: 1052, nPrzebudow: 24, kroki: 96 },
    pola: { pos: '45f17cffcc418c1de527b5b5', vel: '9f5cd60a6cc0b68e6b02fd22', acc: '05119f4a4c131babe7e84c93', maskaW: '2a9143dd1022b88b81501488', szkoda: '4c30569907dd9734f99d655c', A: 'a2ead823edd5e06feb97037e', etyk: 'c4eaf26d27e838c1a57122e0', aktywny: '73ed9d6b8210e3092f90d54f', nieruchomy: '1e5648b593065bbddc42debf', L: 'e39f69c93bb25975893ee832', D: '61149c95cf7620b288e00258', F0: '767022c4cef42d9fb16f7141' },
  },
  S1odkotwicz: {
    liczniki: { zerwanych: 2134, zerwanychZginaniem: 0, plast: 239724, przepelnienia: 0, maxKontaktow: 14, maxKomorka: 18, przepelnieniaKomorek: 36, kontaktowOst: 1512, nPrzebudow: 24, kroki: 96 },
    pola: { pos: 'd78786e2f31b6bc71b3647b0', vel: 'bfd67c3146cd86fbdd58799b', acc: 'b4c8446172b0bb9c439ed51d', maskaW: '1d61084c7712e7baaf21326c', szkoda: 'f875794101cbdd3396fc11c2', A: 'fd654ee317658caeace79918', etyk: '62993b9f04ee1c1792b817fa', aktywny: '55941aa5e7b1bc8034fd4bc9', nieruchomy: '1e5648b593065bbddc42debf', L: '5a5077de5fc49d69b0d05bc6', D: 'dadfeb7e8fd28e74c196c8d0', F0: 'b1244b168ecd8d1478230caa' },
  },
  S1odkotwiczBezGruntu: {
    liczniki: { zerwanych: 0, zerwanychZginaniem: 0, plast: 97942, przepelnienia: 0, maxKontaktow: 0, maxKomorka: 18, przepelnieniaKomorek: 20, kontaktowOst: 0, nPrzebudow: 24, kroki: 96 },
    pola: { pos: '8892dc0a8cb8fb4d6b3562ab', vel: 'f84410db5bbdffed48059519', acc: '6e17b9a00413b3fe524b18d4', maskaW: '14446ef49f3ccb066d8653c2', szkoda: 'df77662b63be58a1de641a3b', A: 'a0855442af39a394a7c96a4e', etyk: '7d9e7a35ceb5e11a044e79bb', aktywny: '55941aa5e7b1bc8034fd4bc9', nieruchomy: '1e5648b593065bbddc42debf', L: 'ab710f204717576d616b6edf', D: '173a9e6a332aabd4fdb1e32a', F0: '767022c4cef42d9fb16f7141' },
  },
};

const bajty = (t) => Buffer.from(t.buffer, t.byteOffset, t.byteLength);
const pamiecStatyki = new Map(); // S1, S2 i S4 to ta sama wieża: statyka projektu liczy się raz
const buduj = (plan, par) => zbuduj(plan.scena, par, { pamiecStatyki });

const LIMIT = { timeout: 1_200_000 }; // limit awaryjny: wątek, który stanął, nie wiesza zestawu; szeroki, bo przy zajętej maszynie cały test trwa 5 minut
const biegi = uruchomBiegi(); // ruszają od razu

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

test('migawka innej budowy nie wchodzi: to samo n i ziarno nie wystarczy', () => {
  const s1 = new WzorzecCpu(buduj(S1())), s4 = new WzorzecCpu(buduj(S4()));
  const mig = s1.migawka();
  assert.deepEqual(Object.keys(mig.budowa).sort(), ['K', 'capEtyk', 'gProj', 'n', 'nKom', 'skrot']);
  s1.wgraj(mig);
  assert.equal(s4.n, s1.n);
  assert.throws(() => s4.wgraj(mig), /innej budowy/);
  assert.throws(() => s1.wgraj({ ...mig, budowa: undefined }), /innej budowy/);
  for (const k of Object.keys(mig.budowa)) assert.throws(() => s1.wgraj({ ...mig, budowa: { ...mig.budowa, [k]: -1 } }), /innej budowy/, k);
});

// Mały stan do progów § 8: węzeł 2 stoi, węzeł 3 nie żyje.
function stanPodkroku() {
  const n = 4;
  return {
    maskaW: new Uint32Array(n).fill(3), szkoda: new Float32Array(n), A: new Float32Array(n), etyk: new Uint16Array(n),
    L: new Float32Array(18 * n), D: new Float32Array(18 * n), F0: new Float32Array(18 * n), acc: new Float32Array(3 * n),
  };
}
const AKTYWNY = Uint8Array.of(1, 1, 1, 0), NIERUCHOMY = Uint8Array.of(0, 0, 1, 0);
function porownajZmiane(zmien, opcje) {
  const wynik = stanPodkroku();
  zmien(wynik);
  return porownajPodkrok(stanPodkroku(), wynik, AKTYWNY, NIERUCHOMY, opcje);
}

test('porownajPodkrok: progi § 8 po obu stronach', () => {
  assert.equal(porownajZmiane(() => {}).zaliczony, true);
  for (const [pole, indeks, licznik] of [['szkoda', 1, 's'], ['A', 1, 'a'], ['L', 18 + 5, 'l'], ['D', 18 + 5, 'd']]) {
    assert.equal(porownajZmiane((w) => { w[pole][indeks] = 5e-4; }).zaliczony, true, `${pole} różne o 5e-4`);
    const r = porownajZmiane((w) => { w[pole][indeks] = 2e-3; });
    assert.equal(r.zaliczony, false, `${pole} różne o 2e-3`);
    assert.equal(r[licznik], 1, `${pole}: licznik ${licznik}`);
  }
  assert.equal(porownajZmiane((w) => { w.acc[3] = 4; }).zaliczony, true, '|Δa| = 4');
  const a = porownajZmiane((w) => { w.acc[3] = 6; });
  assert.equal(a.zaliczony, false, '|Δa| = 6');
  assert.equal(a.daMax, 6);
  assert.equal(a.ponadA, 1);
  const m = porownajZmiane((w) => { w.maskaW[1] = 1; });
  assert.equal(m.zaliczony, false, 'sama różnica maski');
  assert.equal(m.maski, 1);
  assert.deepEqual([m.s, m.a, m.l, m.d, m.ponadA], [0, 0, 0, 0, 0]);
});

test('porownajPodkrok: stojące bez przyspieszenia, martwe poza porównaniem, F0 i etykieta poza zaliczeniem', () => {
  assert.equal(porownajZmiane((w) => { w.acc[3 * 2] = 1000; }).zaliczony, true, 'stojący');
  assert.equal(porownajZmiane((w) => { w.szkoda[3] = 1; w.maskaW[3] = 0; w.acc[3 * 3] = 1000; w.L[18 * 3] = 1; }).zaliczony, true, 'martwy');
  const f0 = porownajZmiane((w) => { w.F0[18] = 1000; });
  assert.equal(f0.zaliczony, true);
  assert.equal(f0.f0, 1);
  const zmienEtyk = (w) => { w.etyk[1] = 7; };
  const e = porownajZmiane(zmienEtyk);
  assert.equal(e.zaliczony, true, 'bez kotwic Node nie liczy etykiety (§ 1.6)');
  assert.equal(e.etyk, 1);
  assert.equal(porownajZmiane(zmienEtyk, { liczEtyk: true }).zaliczony, false);
});

test('porownajPodkrok: NaN nigdy nie przechodzi', () => {
  const acc = porownajZmiane((w) => { w.acc.fill(NaN); });
  assert.equal(acc.zaliczony, false, 'acc = NaN');
  assert.equal(acc.daMax, Infinity);
  assert.equal(acc.ponadA, 2, 'stojący i martwy poza porównaniem');
  for (const [pole, indeks] of [['szkoda', 1], ['A', 1], ['L', 18], ['D', 18], ['F0', 18]]) {
    const r = porownajZmiane((w) => { w[pole][indeks] = NaN; });
    assert.equal(r.zaliczony, false, `${pole} = NaN`);
    assert.equal(r.nan, 1, `${pole}: licznik NaN`);
    const wzorZNaN = stanPodkroku();
    wzorZNaN[pole][indeks] = NaN;
    assert.equal(porownajPodkrok(wzorZNaN, stanPodkroku(), AKTYWNY, NIERUCHOMY).zaliczony, false, `NaN we wzorze: ${pole}`);
  }
  assert.equal(porownajZmiane((w) => { w.szkoda[1] = NaN; }).sMax, Infinity);
});

test('kI: limit prędkości trzyma kierunek (żadna scena go nie osiąga, więc biegi tego nie widzą, § 1.6)', () => {
  const m = new WzorzecCpu(buduj(S4()));
  m.vel[0] = 3e4; m.vel[1] = 0; m.vel[2] = -4e4;
  m.vel[3] = 30; // wolny węzeł obok zostaje bez zmian
  m._przebiegI();
  assert.equal(m.vel[0], Math.fround(3e4 * (4000 / 5e4)));
  assert.equal(m.vel[2], Math.fround(-4e4 * (4000 / 5e4)));
  assert.equal(m.vel[3], 30);
  assert.equal(m.vmaxOstatni, 4000);
});

test('parametry końcowe z § 2.1 i nakładka ziarna', () => {
  assert.deepEqual(PARAMETRY, WZOR_PARAMETROW, 'parametry inne niż parametry-spec4.json');
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

// Od tego miejsca testy czekają na wątki robocze; zwykłe są wyżej, żeby liczyły się równolegle z biegami.

for (const nazwa of ['S1', 'S3', 'S4']) {
  test(`budowa ${nazwa} bajt w bajt z model-spec4`, LIMIT, async () => {
    const { budowa } = await biegi(nazwa);
    const wz = WZOR[nazwa];
    assert.deepEqual(Object.keys(budowa.pola).sort(), Object.keys(wz.pola).sort(), `${nazwa}: lista pól`);
    for (const k of Object.keys(wz.pola)) assert.equal(budowa.pola[k], wz.pola[k], `${nazwa}: pole ${k} różni się od model-spec4`);
    for (const k of Object.keys(wz.liczby)) assert.equal(budowa.liczby[k], wz.liczby[k], `${nazwa}: ${k}`);
  });
}

for (const [nazwa, d] of Object.entries(BIEGI)) {
  test(`bieg ${nazwa}: ${d.klatki} klatek od f = ${d.od}, stan bit w bit z model-spec4`, LIMIT, async () => {
    const r = await biegi(nazwa);
    const wz = WZOR_BIEGOW[nazwa];
    for (const k of POLA_STANU) assert.equal(r.pola[k], wz.pola[k], `${nazwa}: pole ${k} różni się od model-spec4`);
    assert.deepEqual(r.liczniki, wz.liczniki, `${nazwa}: liczniki`);
  });
  test(`bieg ${nazwa}: migawka, klon po wgraj liczy podkrok jak oryginał w dalszym biegu, także po zapisie do pliku`, LIMIT, async () => {
    const { migawka: m } = await biegi(nazwa);
    assert.deepEqual(m.rozne, [], `${nazwa}: klon inny niż oryginał`);
    assert.equal(m.plik, true, `${nazwa}: odczyt z pliku inny niż zapis`);
  });
}

test('migawka S1 niesie falę, plastyczność i wypiek: inaczej porównanie klonu niczego by nie mówiło', LIMIT, async () => {
  const { migawka: s1 } = await biegi('S1');
  assert.ok(s1.aDodatnie > 0, 'fala');
  assert.ok(s1.lRozne > 0, 'plastyczność');
  assert.ok(s1.f0Rozne > 0, 'wypiek sprężenia');
});

test('kCzysc bit w bit: S4, rozerwanie z zostawieniem ziaren (S = 3) i pchnięcia', LIMIT, async () => {
  const { czysc: c } = await biegi('S4');
  assert.equal(c.rozne, null);
  assert.ok(c.zerwanych > 0, 'zdarzenia coś zerwały');
  assert.equal(c.zerwanychPrzebiegi, c.zerwanych);
  assert.ok(c.rozerwane > 100, `węzły po cięciu ${c.rozerwane}`);
});

test('kCzysc bit w bit: S2, front usunięć i rozerwań (S = 2)', LIMIT, async () => {
  const { czysc: c } = await biegi('S2');
  assert.equal(c.rozne, null);
  assert.ok(c.zerwanych > 0, 'zdarzenia coś zerwały');
  assert.equal(c.zerwanychPrzebiegi, c.zerwanych);
  assert.ok(c.martwe > 0, 'są martwe');
});
