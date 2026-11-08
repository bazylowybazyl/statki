// Demo autostrady wokół Ziemi (dema/autostrada/): czysta sieć, ruch i rozmieszczenie infrastruktury — bez GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import { zbudujSiec, HW, NODE, DEG, complexes, punktNaSciezce, hubToWorld, worldToHub } from '../dema/autostrada/siec.js';
import { utworzRuch, FAZA, STAN_SWIATLA, KLASY, HIST } from '../dema/autostrada/ruch.js';
import { zbudujInfrastrukture, TRYB_LAMPY } from '../dema/autostrada/infrastruktura.js';
import { zbudujWstegi, RODZAJ } from '../dema/autostrada/wstegi.js';

const R = (p) => Math.hypot(p.x, p.y);

test('sieć: przekrój poza portem i redą, rampy dochodzą do zatok, tranzytów i kosmosu', () => {
  const siec = zbudujSiec();
  assert.ok(HW.edgeIn > HW.redaOuter, 'jezdnia wewnętrzna poza redą');
  const rampy = siec.paths.filter((p) => p.kind === 'rampOff' || p.kind === 'rampOn');
  assert.equal(rampy.length, 2 * (8 + 4), '8 zatok i 4 tranzyty, po wjeździe i zjeździe');
  for (const p of rampy) {
    const q = p.probki;
    const koniec = p.kind === 'rampOff' ? q.n - 1 : 0;
    const rPort = Math.hypot(q.x[koniec], q.y[koniec]);
    assert.ok(rPort < 51000, `${p.id}: koniec po stronie portu (r ${rPort | 0})`);
    const styk = p.kind === 'rampOff' ? 0 : q.n - 1;
    assert.ok(Math.abs(Math.hypot(q.x[styk], q.y[styk]) - HW.iL3) < 30, `${p.id}: styk z L3`);
  }
  for (const p of siec.paths.filter((x) => x.kind === 'gateIn' || x.kind === 'gateOut')) {
    const q = p.probki;
    const daleko = p.kind === 'gateIn' ? 0 : q.n - 1;
    assert.ok(Math.hypot(q.x[daleko], q.y[daleko]) > 80000, `${p.id}: wrota sięgają głębokiego kosmosu`);
  }
});

test('sieć: ścieżki bez skoków, kurs ciągły, profil prędkości dodatni', () => {
  const siec = zbudujSiec();
  for (const p of siec.paths) {
    const q = p.probki;
    for (let i = 1; i < q.n; i++) {
      const d = Math.hypot(q.x[i] - q.x[i - 1], q.y[i] - q.y[i - 1]);
      assert.ok(d < 300, `${p.id}: skok ${d | 0} j. w próbce ${i}`);
    }
    for (let i = 0; i < q.n; i++) assert.ok(q.vp[i] > 0, `${p.id}: profil vp`);
  }
});

test('hub: przekształcenie w obie strony zgodne', () => {
  for (const a of complexes()) {
    const w = hubToWorld(a, -810, 7400);
    const h = worldToHub(a, w.x, w.y);
    assert.ok(Math.abs(h.x + 810) < 1e-6 && Math.abs(h.z - 7400) < 1e-6);
  }
});

test('punktNaSciezce: końce i środek', () => {
  const siec = zbudujSiec();
  const q = siec.paths.find((p) => p.kind === 'rampOff').probki;
  const out = { x: 0, y: 0, h: 0, k: 0 };
  punktNaSciezce(q, 0, out);
  assert.ok(Math.abs(out.x - q.x[0]) < 1e-6);
  punktNaSciezce(q, q.len, out);
  assert.ok(Math.abs(out.x - q.x[q.n - 1]) < 1e-6);
  punktNaSciezce(q, q.len / 2, out);
  assert.ok(Number.isFinite(out.h));
});

test('ruch: nikt nie przejeżdża linii stopu na czerwonym, kolejka powstaje i się rozładowuje, sygnał wraca', () => {
  const ruch = utworzRuch({ ziarno: 11, gestosc: 1 });
  ruch.rozruch();
  for (let i = 0; i < 300; i++) ruch.step();
  assert.ok(ruch.pojazdy.length > 700, `na drodze ${ruch.pojazdy.length}`);
  assert.equal(ruch.atlasStart(), true);
  assert.equal(ruch.atlasStart(), false, 'drugi start w trakcie sekwencji odrzucony');
  const w = ruch.K7[ruch.atlas.K];
  assert.equal(w.a, 315, 'Atlas startuje z hali K-7 na 315° sceny (kompleks gracza)');
  let maksStoi = 0;
  let czerwoneT = 0;
  let wylot = -1;
  for (let i = 0; i < 1000; i++) {
    ruch.step();
    maksStoi = Math.max(maksStoi, w.stoi[0] + w.stoi[1]);
    if (w.stan === STAN_SWIATLA.CZERWONE) czerwoneT += ruch.dt;
    if (wylot < 0 && ruch.atlas.stan === 'poza') wylot = ruch.czas;
  }
  assert.equal(ruch.stat.przejazdyNaCzerwonym, 0, 'prawda sygnału');
  assert.ok(maksStoi > 5, `kolejka przed K-7: ${maksStoi}`);
  assert.ok(czerwoneT > 15 && czerwoneT < 70, `czerwone ${czerwoneT.toFixed(1)} s`);
  assert.ok(wylot > 0, 'Atlas wyleciał');
  assert.equal(w.faza, FAZA.MAIN, 'sygnał wrócił do zielonego');
  assert.equal(w.wymuszenie, false);
  assert.equal(ruch.atlas.stan, 'dok', 'Atlas gotowy do następnego wylotu');
});

test('ruch: pół godziny bez zakorkowania, pozy skończone, wszystkie klasy żyją', () => {
  const ruch = utworzRuch({ ziarno: 23, gestosc: 1 });
  ruch.rozruch();
  let sumaV = 0;
  let nV = 0;
  for (let i = 0; i < 18000; i++) {
    if (i % 900 === 899) ruch.atlasStart();
    ruch.step();
    if (i > 3000 && i % 200 === 0) {
      for (const v of ruch.pojazdy) { sumaV += v.vel; nV++; }
    }
  }
  ruch.odswiezPozy(0.05);
  for (const v of ruch.pojazdy) {
    assert.ok(Number.isFinite(v.x + v.y + v.h + v.kr), 'poza skończona');
    const r = Math.hypot(v.x, v.y);
    assert.ok(r > 42000 && r < 86000, `r ${r | 0} (${v.k.id}, tryb ${v.tryb})`);
  }
  const srednia = sumaV / nV;
  assert.ok(srednia > 300, `średnia prędkość ${srednia | 0} j/s`);
  assert.equal(ruch.stat.przejazdyNaCzerwonym, 0);
  for (const klasa of ['ciezarowka', 'prom', 'policja', 'turysta', 'kontenerowiec', 'dalekobiezny', 'tankowiec']) {
    assert.ok(ruch.licznik[klasa] > 0, `klasa ${klasa}`);
  }
  assert.ok(ruch.stat.zjazdy > 1000, `zjazdy ${ruch.stat.zjazdy}`);
});

test('ruch: ciężkie i mega nie wjeżdżają na jezdnię poza pudłem K-7', () => {
  const ruch = utworzRuch({ ziarno: 7, gestosc: 0.4, ciezkieNaWezel: 3 });
  ruch.rozruch();
  let ciezkie = 0;
  for (let i = 0; i < 6000; i++) {
    ruch.step();
    if (i % 25) continue;
    ruch.odswiezPozy(0);
    for (const v of ruch.pojazdy) {
      if (v.k !== KLASY.ciezki && v.k !== KLASY.mega) continue;
      ciezkie++;
      const r = Math.hypot(v.x, v.y);
      if (r < HW.edgeIn - 50 || r > HW.edgeOut + 50) continue;
      // Na jezdni: musi być w pudle swojego K-7 i w fazie przejazdu albo czyszczenia.
      const a = v.K.a * DEG;
      const wzdluz = Math.abs(-v.x * Math.sin(a) + v.y * Math.cos(a));
      assert.ok(wzdluz < NODE.boxHalf + 200, `${v.k.id} poza pudłem: ${wzdluz | 0}`);
      assert.notEqual(v.K.faza, FAZA.MAIN, `${v.k.id} na jezdni przy zielonym dla głównej`);
    }
  }
  assert.ok(ciezkie > 0, 'test widział ciężkie');
});

test('ruch: poza gładka w każdej klatce — zmiana pasa, zjazd, wtopienie i zawrotka bez skoków pozycji i kursu', () => {
  const ruch = utworzRuch({ ziarno: 31, gestosc: 1 });
  ruch.rozruch();
  for (let i = 0; i < 600; i++) ruch.step();
  const fps = 60;
  const naKrok = Math.round(ruch.dt * fps);
  const poprz = new Map();
  let naj = 0;
  let najKurs = 0;
  let opis = '';
  let zmian0 = ruch.stat.zmiany;
  let zjazdy0 = ruch.stat.zjazdy;
  for (let k = 0; k < 900; k++) {
    if (k === 200) ruch.atlasStart();
    ruch.step();
    for (let j = 0; j < naKrok; j++) {
      const tau = j / fps;
      ruch.odswiezPozy(tau);
      for (const v of ruch.pojazdy) {
        const stary = poprz.get(v);
        if (stary) {
          const d = Math.hypot(v.x - stary.x, v.y - stary.y);
          // Nadmiar ponad to, co pojazd przejechał w klatce.
          const nadmiar = d - Math.max(v.vel, stary.vel) / fps;
          if (nadmiar > naj) { naj = nadmiar; opis = `${v.k.id} tryb ${v.tryb} ${v.sciezka?.kind ?? 'pas'} v ${v.vel | 0}`; }
          let dh = v.h - stary.h;
          dh = Math.abs(Math.atan2(Math.sin(dh), Math.cos(dh)));
          if (v.vel > 100 && dh > najKurs) najKurs = dh;
          stary.x = v.x; stary.y = v.y; stary.h = v.h; stary.vel = v.vel;
        } else poprz.set(v, { x: v.x, y: v.y, h: v.h, vel: v.vel });
      }
    }
  }
  assert.ok(ruch.stat.zmiany > zmian0 && ruch.stat.zjazdy > zjazdy0, 'test widział manewry');
  // AGENT: dawniej ~200 j. (odsunięcie ze złym znakiem na rampach, schodki co krok); zostaje ~10 j. przy wejściu w zawrotkę.
  assert.ok(naj < 12, `skok pozycji ${naj.toFixed(1)} j. na klatkę (${opis})`);
  assert.ok(najKurs < 0.05, `skok kursu ${(najKurs * 180 / Math.PI).toFixed(2)}° na klatkę`);
});

test('ruch: historia pozycji — nowy wiersz co 0,2 s, poza zgodna ze slotem, sloty wracają', () => {
  const ruch = utworzRuch({ ziarno: 5, gestosc: 0.5 });
  ruch.rozruch();
  const w0 = ruch.hist.wersja;
  for (let i = 0; i < 20; i++) ruch.step();
  assert.equal(ruch.hist.wersja - w0, 10, 'dwa kroki 0,1 s na wiersz');
  const v = ruch.pojazdy.find((q) => q.slot >= 0);
  const o = (ruch.hist.wiersz * HIST.SLOTY + v.slot) * 2;
  assert.ok(Math.abs(ruch.hist.dane[o] - v.x) < 1e-2 && Math.abs(ruch.hist.dane[o + 1] - v.y) < 1e-2, 'wiersz niesie pozę z chwili kroku');
  for (let i = 0; i < 3000; i++) ruch.step();
  const sloty = new Set();
  for (const q of ruch.pojazdy) { if (q.slot >= 0) { assert.ok(!sloty.has(q.slot), 'slot jednego pojazdu'); sloty.add(q.slot); } }
  assert.equal(sloty.size, ruch.pojazdy.length, 'każdy pojazd ma slot');
});

test('infrastruktura: bary stopu po stronie napływu (kształt Z), głowice na liniach', () => {
  const inf = zbudujInfrastrukture();
  const bary = inf.lampy.filter((l) => l.tryb === TRYB_LAMPY.BAR_STOPU);
  assert.ok(bary.length > 40);
  for (const k of [0, 1, 2, 3]) {
    const c = complexes()[k] * DEG;
    const wewn = bary.filter((l) => l.grupa === k && Math.hypot(l.x, l.y) < HW.median);
    const zewn = bary.filter((l) => l.grupa === k && Math.hypot(l.x, l.y) > HW.median);
    const strona = (l) => Math.sign(-l.x * Math.sin(c) + l.y * Math.cos(c));
    assert.ok(wewn.every((l) => strona(l) > 0), 'jezdnia wewnętrzna (CW) napływa od +θ');
    assert.ok(zewn.every((l) => strona(l) < 0), 'jezdnia zewnętrzna (CCW) napływa od −θ');
  }
  assert.equal(inf.lampyFG.filter((l) => l.tryb === TRYB_LAMPY.GLOWICA).length, 4 * 2 * 3, '3 głowice na jezdnię na K-7');
  assert.ok(inf.bramownice.length > 30);
  for (const b of inf.bramownice) {
    const r = R(b);
    assert.ok(r > HW.edgeIn && r < HW.edgeOut, `bramownica na drodze (r ${r | 0})`);
  }
});

test('wstęgi: spójne tablice, rodzaje obecne, pasy K-7 z indeksem węzła', () => {
  const dane = zbudujWstegi(zbudujSiec(), { segmentyRing: 240 });
  const n = dane.pozycje.length / 3;
  assert.equal(dane.sv.length / 2, n);
  assert.equal(dane.meta.length / 4, n);
  assert.ok(dane.indeksy.every((i) => i < n));
  const rodzaje = new Set();
  let pudlaOk = true;
  for (let i = 0; i < n; i++) {
    const r = dane.meta[i * 4];
    rodzaje.add(r);
    if (r === RODZAJ.PUDLO && !(dane.meta[i * 4 + 3] >= 0)) pudlaOk = false;
  }
  for (const r of Object.values(RODZAJ)) assert.ok(rodzaje.has(r), `rodzaj ${r}`);
  assert.ok(pudlaOk, 'pasy K-7 znają swój węzeł');
});
