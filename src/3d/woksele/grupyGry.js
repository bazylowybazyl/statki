// Kratery z misji 1 dla wiązanych wokseli: co dzieje się z wokselami, gdy gra łamie kawałek bazy, zrywa szyję albo zaczyna upadek. Moduł czysty: bez three i DOM, działa w teście.
// Liczby wzięte z planSekwencji w scenaBazy.js (próba B1), a czas względem chwili zdarzenia: tam było jedno nagranie, tu zdarzenia przychodzą z rozgrywki w dowolnej kolejności.
// Układ: X = x bazy, Y = −z bazy, Z = k7HeightToZ(wysokość).
import { k7HeightToZ } from '../haloRing/haloPortK7Layout.js';
import { prng } from './scena.js';

const TAU = Math.PI * 2;
const KUBELEK = 160;
const F = (t) => Math.round(60 * t);
const krater = (o) => ({ rdzen: 0.4, rS: 1, tau: 0.03, dz: 0, usunStojace: true, ...o });
/** Obrót startowy przewracanego wieżowca miasta [rad/s] (przewrot): 0,3 jak wieża przy zerwaniu szyi (WIEZA_OM w wGrze.js), 0,5 kładzie go szybciej. */
export const PRZEWROT_OM = 0.3;
/** Upadek bazy (HP 0, voxFall, w demie U): kotwice puszczają CAŁE części falą od osi habitatu, start [s] i prędkość fali [j./s] (czesciUpadku). */
export const UPADEK_FALA = Object.freeze({ start: 3, v: 1500 });
/**
 * Boki ciągnięte przez środek przy upadku (prośba użytkownika 2026-11-12: „środkowy habitat jako najcięższy ma widocznie pociągnąć za sobą lewą i prawą stronę,
 * zwinąć je trochę do środka, a one mają polecieć w dół za centrum”). Fala puszcza środek pierwszy, a boki kilka sekund później, czyli boki trzyma jeszcze
 * gasnąca antygrawitacja, a środek już spada. Części nie mają między sobą wiązań, więc ciągnięcie daje prędkość startowa części spoza miasta: obrót om
 * [rad/s] wokół osi poziomej na skraju bazy (R_dal) na wysokości zOsi [j.], wspólnej dla wszystkich części, więc reaktor jedzie razem z pomostem pod nim.
 * Wewnętrzny koniec idzie w dół szybciej niż zewnętrzny (om · (R_dal − r)), cała część jedzie ku osi habitatu (om · (z − zOsi)) i przechyla się w „V”.
 * Swobodny spadek sam niczego nie ciągnie (ciężkie i lekkie spada tak samo): pociągnięcie bierze się z tego, że boki puszczają później.
 */
export const UPADEK_ZWIN = Object.freeze({ om: 0.06, zOsi: -2500 });
/**
 * Boki przy upadku z linami (scenaBazy.js, planLin; prośba użytkownika 2026-11-12: „pusta przestrzeń ciągnie w dół — trzeba dodać coś, co trzyma, jakieś druty”).
 * Liny od pomostów do dysku i spoiny między częściami boków ciągną boki naprawdę, więc boki puszczają kolejno w oknie [po, po + rozrzut] s od startu fali (bliżej osi
 * wcześniej), a nie falą 1500 j./s: część trzymana kotwicą jeszcze kilka sekund rozciągnęłaby linę do zerwania. Sąsiednie części dzieli 0,2–0,6 s, a środek w tym czasie
 * ściąga łańcuch po kolei: boki składają się w „V” ku osi i lecą za środkiem (pomiar GPU 2026-11-12, demo B1R, U). Obrót startowy (UPADEK_ZWIN) przy linach wyłączony.
 */
export const UPADEK_BOKI_LINY = Object.freeze({ po: 0.4, rozrzut: 1.6 });

/** w: { n, pos } wypieku, l: createPirateBaseLayout, dx: bok komórki, ziarno: los miejsc, tylko wygląd. */
export function createGrupyGry({ w, l, dx, ziarno = 77 }) {
  const los = prng(ziarno);
  const kubelki = new Map();
  const klucz = (x, y) => (Math.floor(y / KUBELEK) + 8192) * 16384 + (Math.floor(x / KUBELEK) + 8192);
  for (let i = 0; i < w.n; i++) {
    const k = klucz(w.pos[3 * i], w.pos[3 * i + 1]);
    let q = kubelki.get(k);
    if (!q) kubelki.set(k, (q = []));
    q.push(i);
  }

  /** Węzeł najbliższy punktowi w wypieku, −1: nic bliżej niż maxR. Pozycje początkowe: nosiciel krateru i tak jedzie ze swoim węzłem. */
  function szukaj(x, y, z, maxR = 2 * KUBELEK) {
    const zas = Math.ceil(maxR / KUBELEK);
    let naj = maxR * maxR, wyn = -1;
    for (let b = -zas; b <= zas; b++) for (let a = -zas; a <= zas; a++) {
      const q = kubelki.get(klucz(x + a * KUBELEK, y + b * KUBELEK));
      if (!q) continue;
      for (let e = 0; e < q.length; e++) {
        const i = q[e], p = w.pos;
        const d = (p[3 * i] - x) ** 2 + (p[3 * i + 1] - y) ** 2 + (p[3 * i + 2] - z) ** 2;
        if (d < naj) { naj = d; wyn = i; }
      }
    }
    return wyn;
  }

  const Hs = l.habitat;
  const rMin = Math.max(75, 1.9 * dx);
  const dodaj = (lista, t, x, y, z, o, maxR) => {
    const nos = szukaj(x, y, z, maxR);
    if (nos >= 0) lista.push(krater({ f: F(t), nos, ...o }));
  };

  /**
   * Budynek o rzucie wx × wy (osie węzłów) ze środkiem (cx, cy): salwy po obwodzie tuż nad płaszczyzną gry, na końcu przekrój przez oś (bez niego trzon stoi na rdzeniu, jak kula wieży w S5). t0: opóźnienie, serie: ile salw.
   * szybko (taran): statek właśnie przeciął budynek w płaszczyźnie gry, więc przekrój idzie od razu i na wysokości kadłuba, a salwy w 0,3 s. Zwykłe 2,4 s nadgryzania zostawiało dach w powietrzu długo po przelocie statku (uwaga użytkownika 2026-11-12).
   */
  function budynek(lista, cx, cy, wx, wy, t0, serie, naSerie, szybko = false) {
    const zNad = k7HeightToZ(l.spec.pier.deckY1);
    const tSalw = szybko ? 0.3 : 2.2, tCiecia = szybko ? 0.05 : 2.4;
    for (let s = 0; s < serie; s++) {
      const t = t0 + (tSalw * s) / serie;
      for (let q = 0; q < naSerie; q++) {
        const a = TAU * los();
        const ax = Math.cos(a), ay = Math.sin(a), sk = 0.5 / Math.max(Math.abs(ax) / wx, Math.abs(ay) / wy);
        dodaj(lista, t + (szybko ? 0.05 : 0.22) * los(), cx + ax * sk, cy + ay * sk, zNad + 100 + 160 * los(), { r: rMin, J: 120, rP: 170, rodz: q === 0 ? 'glowna' : 'mala' });
      }
    }
    const R = 0.5 * Math.sqrt(wx * wx + wy * wy) + 20;
    for (const [dt, dz] of (szybko ? [[0, 20], [0.08, 180]] : [[0, 120], [0.12, 300]])) dodaj(lista, t0 + tCiecia + dt, cx, cy, zNad + dz, { r: R, rdzen: 0.08, rS: 0.3, J: 80, rP: 320, rodz: 'wieza' });
    return lista;
  }

  /** Reaktor antygrawitacyjny na pomoście (budowla martwa): obudowa pęka jak dawny wieżowiec, kolumna z pierścieniem pola spada na pomost. */
  function reaktor(id) {
    const h = (l.antigravs || []).find((q) => q.id === id);
    if (!h) return [];
    const wzdluzX = Math.abs(h.ux) > 0.5;
    return budynek([], h.x, -h.z, wzdluzX ? h.w : h.d, wzdluzX ? h.d : h.w, 0, 6, 3);
  }

  /**
   * Wieżowiec miasta pęka (pula do zera, taran, rozpad): same krótkie salwy po obwodzie tuż nad płaszczyzną gry (ozdoba: błysk i odłamki tam, gdzie strzelał gracz).
   * Upada przez przewrot() (wGrze, voxBreak), nie przez kule przekroju: dawny przekrój był symetryczny (budynek siadał pionowo między sąsiadami), liczony od
   * pokładu pomostu (kikut 30–50 % wysokości nad tarasem), zależał od żywego nosiciela i żarzył naraz 13–17 pięter (raport FABLE-3 2026-11-12). Kawałek gry =
   * jeden wieżowiec = jedna część wokseli o tym samym id.
   */
  function wiezowiec(id, szybko = false) {
    const h = (Hs.buildings || []).find((q) => q.id === id);
    if (!h) return [];
    const wx = h.ux ? h.w : h.d, wy = h.ux ? h.d : h.w;
    const lista = [], zNad = k7HeightToZ(l.spec.pier.deckY1), serie = szybko ? 2 : 3, tSalw = szybko ? 0.3 : 0.5;
    for (let s = 0; s < serie; s++) {
      for (let q = 0; q < 3; q++) {
        const a = TAU * los();
        const ax = Math.cos(a), ay = Math.sin(a), sk = 0.5 / Math.max(Math.abs(ax) / wx, Math.abs(ay) / wy);
        dodaj(lista, (tSalw * s) / serie + 0.05 * los(), h.x + ax * sk, -h.z + ay * sk, zNad + 100 + 160 * los(), { r: rMin, J: 120, rP: 170, rodz: q === 0 ? 'glowna' : 'mala' });
      }
    }
    return lista;
  }

  /**
   * Przewrót wieżowca miasta (raport FABLE-3 § 4.3, 2026-11-12): rekord dla solver.puscCzesc (bez od i n — dokłada wGrze z tabeli części). Cięcie płaszczyzną
   * dwie warstwy nad podstawą (zMin), obrót om ku stronie upadku wokół krawędzi rzutu po tej stronie (piv). Puszczona część dostaje etykietę oderwania od razu,
   * więc nie wisi w tłumieniu „stoi albo pęka”. f: kierunek upadku w układzie węzłów (jednostkowy), om w rad/s. Pomiar w Node: B-13 na zewnątrz 8° / 24° / 49°
   * po 0,5 / 1,5 / 2,5 s i przelatuje nad krawędzią dysku, B-01 kładzie się na sąsiada i o niego rozbija. Null: to nie wieżowiec miasta.
   */
  function przewrot(id, f, om = PRZEWROT_OM) {
    const h = (Hs.buildings || []).find((q) => q.id === id);
    if (!h) return null;
    const wx = h.ux ? h.w : h.d, wy = h.ux ? h.d : h.w;
    const zMin = k7HeightToZ(h.baseY) + 2 * dx;
    const sk = 0.5 / Math.max(Math.abs(f.x) / wx, Math.abs(f.y) / wy, 1e-9);
    return { zMin, piv: [h.x + f.x * sk, -h.z + f.y * sk, zMin], om: [-f.y * om, f.x * om, 0] };
  }

  /**
   * Plan upadku bazy: części z wypieku (budynki: start, n, nazwa) z czasem puszczenia t (fala od osi habitatu, środek części) i dla części spoza miasta
   * (pomosty, reaktory, zbiorniki, magazyn) prędkością startową piv, om dla solver.puscCzesc (UPADEK_ZWIN). Posortowane po t. Wspólne dla gry (wGrze) i dema (U).
   */
  function czesciUpadku(budynki, { start = UPADEK_FALA.start, v = UPADEK_FALA.v, zwin = UPADEK_ZWIN, zLinami = false } = {}) {
    const p = w.pos;
    let rDal2 = 0;
    const lista = (budynki || []).map((c) => {
      let sx = 0, sy = 0;
      for (let i = c.start; i < c.start + c.n; i++) {
        const x = p[3 * i], y = p[3 * i + 1];
        sx += x; sy += y;
        if (x * x + y * y > rDal2) rDal2 = x * x + y * y;
      }
      const n = Math.max(1, c.n), x = sx / n, y = sy / n;
      return { od: c.start, n: c.n, nazwa: c.nazwa, t: start + Math.sqrt(x * x + y * y) / v, x, y };
    });
    const rDal = Math.sqrt(rDal2);
    for (const c of lista) {
      const r = Math.sqrt(c.x * c.x + c.y * c.y);
      if (zLinami && r > Hs.drumR) c.t = start + UPADEK_BOKI_LINY.po + (UPADEK_BOKI_LINY.rozrzut * (r - Hs.drumR)) / Math.max(1, rDal - Hs.drumR);
      if (!zLinami && zwin?.om > 0 && r > Hs.drumR) {
        const ux = c.x / r, uy = c.y / r;
        c.piv = [rDal * ux, rDal * uy, zwin.zOsi];
        c.om = [zwin.om * uy, -zwin.om * ux, 0];
      }
      delete c.x; delete c.y;
    }
    return lista.sort((a, b) => a.t - b.t);
  }

  /** Kierunek upadku wieżowca bez danych z gry: na zewnątrz od osi habitatu (układ węzłów). */
  function naZewnatrz(id) {
    const h = (Hs.buildings || []).find((q) => q.id === id);
    if (!h) return { x: 0, y: -1 };
    const r = Math.sqrt(h.x * h.x + h.z * h.z) || 1;
    return { x: h.x / r, y: -h.z / r };
  }

  const szyjaZ = k7HeightToZ(Hs.coreTop) + 2 * dx + 130;

  /** Szyja: jedno cięcie przez cały pierścień i kratownicę na wysokości szyjaZ. Obrót ku stronie upadku nadaje wieży wGrze (kPuscCzesc), więc wieża leci w całości i rozbija się dopiero, gdy w coś uderzy.
   *  Dawne nacięcie z zawiasem po drugiej stronie nie trzymało głowy: szyja wsuwała się w szyb, a sprężenie rozrywało głowę w locie (badanie 2026-11-07). fx, fy zostają w sygnaturze dla zgodności. */
  function szyja() {
    const lista = [];
    const rN = Hs.neckR, r = 0.8 * rN;
    for (let k = 0; k < 4; k++) {
      const a = (k * TAU) / 4;
      dodaj(lista, 0, rN * Math.cos(a), rN * Math.sin(a), szyjaZ, { r, rdzen: 1, J: 0, rP: 1.3 * r, rodz: 'glowna' });
    }
    // Kratownica w osi, jeśli ma węzły (nosiciel krateru to najbliższy węzeł: przy pustej rurze cięcie w osi wypadłoby na ścianie).
    dodaj(lista, 0, 0, 0, szyjaZ, { r, rdzen: 1, J: 0, rP: 1.3 * r, rodz: 'glowna' }, 0.5 * rN);
    return lista;
  }

  /** Wierzch szybu wyrwany przy zerwaniu szyi: cztery kule na ścianie szybu, ponad pasem gry. W grze szyb pęka w tej samej chwili (index.html, onSnap), więc obraz i kolizje się zgadzają. */
  function kikut() {
    const lista = [];
    const zCore = k7HeightToZ(Hs.coreTop), rS = 0.8 * Hs.coreR;
    for (let k = 0; k < 4; k++) {
      const a = (k * TAU) / 4 + TAU / 8;
      dodaj(lista, 0.3 + 0.1 * k, rS * Math.cos(a), rS * Math.sin(a), zCore - 150, { r: Hs.coreR, rdzen: 0.8, J: 60, rP: 1.3 * Hs.coreR, rodz: 'glowna' });
    }
    return lista;
  }

  /** Jeden sektor dysku. a: kąt bazy, t0: czas od zdarzenia. */
  function sektor(a, t0, lista = []) {
    const R0 = Hs.stemR + dx, R = Hs.discR;
    const kk = TAU / Hs.discSectors;
    const zDol = k7HeightToZ(Hs.discY0), zSr = 0.5 * (zDol + k7HeightToZ(Hs.discY1));
    const rK = R0 + 30;
    const J = 210, Jmala = 90, tauK = 0.3, tauSzew = 0.3, dlW = 340;
    dodaj(lista, t0, rK * Math.cos(a), -rK * Math.sin(a), zSr, { r: Math.max(0.5 * dlW + 60, 2 * dx + 40), rdzen: 0.5, rS: 0, J, rP: 420, tau: tauK, dz: -60, rodz: 'wspornik' });
    const aS = a + 0.5 * kk;
    for (const [fr, rodz, rr, JJ] of [[0.55, 'glowna', 1.2, J], [0.32, 'mala', 1, Jmala], [0.8, 'mala', 1, Jmala]]) {
      const Rg = R0 + fr * (R - R0);
      dodaj(lista, t0 + 0.25 + 0.5 * los(), Rg * Math.cos(aS), -Rg * Math.sin(aS), zSr, { r: rr * Math.max(90, 2.2 * dx), rdzen: 0.2, rS: 0, J: JJ, rP: rodz === 'glowna' ? 640 : 340, tau: tauSzew, dz: (los() < 0.7 ? -1 : 1) * 120 * (0.4 + 0.6 * los()), rodz });
    }
    return lista;
  }

  /** Reszta kawałków (pomosty, zbiorniki, magazyn): łańcuch kraterów wzdłuż dłuższego boku pudła. Pudło skośnego pomostu jest za duże, więc punkt bez węzłów blisko po prostu odpada. */
  function ogolny(c) {
    const lista = [];
    const b = c.box;
    const zS = 0.5 * (k7HeightToZ(b.y0) + k7HeightToZ(b.y1));
    const dX = b.x1 - b.x0, dZ = b.z1 - b.z0, dl = Math.max(dX, dZ);
    const ile = Math.max(2, Math.min(12, Math.ceil(dl / 520)));
    const szeroki = c.kind === 'tank' || c.kind === 'manifold' || c.kind === 'warehouse' || c.kind === 'annex';
    for (let s = 0; s < ile; s++) {
      const u = (s + 0.5) / ile, v = 0.25 + 0.5 * los();
      const x = dX >= dZ ? b.x0 + dX * u : b.x0 + dX * v, zb = dX >= dZ ? b.z0 + dZ * v : b.z0 + dZ * u;
      dodaj(lista, 0.7 * u + 0.15 * los(), x, -zb, zS, { r: (szeroki ? 2.5 : 1.6) * rMin, rdzen: 0.5, J: szeroki ? 180 : 110, rP: szeroki ? 520 : 260, rodz: s % 3 ? 'mala' : 'glowna' }, 420);
    }
    return lista;
  }

  /**
   * Kratery na pęknięcie kawałka gry o tym id. Pusta: kawałek bez obrazu w wokselach. tryb (drugi argument voxBreak): 0 zwykłe pęknięcie (ostrzał, rozpad),
   * 1 zgniot (wieża położyła się na wieżowcu: bez kraterów, wieżowiec traci kotwice w wGrze i rozbija go sama wieża), 2 taran (statek przeciął wieżowiec: przekrój od razu).
   */
  function kawalek(id, tryb = 0) {
    const c = l.chunkById?.get(id);
    if (!c) return [];
    const t = Number(tryb) | 0;
    if (c.kind === 'antigrav') return reaktor(id);
    if (c.kind === 'highrise') return t === 1 ? [] : wiezowiec(id, t === 2);
    // Szyb i głowę prowadzi szyja (zdarzenie voxNeck, a bez niego voxFall): szyja tnie szyb dopiero po przechyle. Cięcie szybu przy pęknięciu H-C wyrzucało płytę pod wieżą, rura szyi wysuwała się w szyb i wieża spadała pionowo.
    if (c.kind === 'core' || c.kind === 'tech') return [];
    if (c.kind === 'disc') {
      const b = c.box;
      return sektor(Math.atan2(0.5 * (b.z0 + b.z1), 0.5 * (b.x0 + b.x1)), 0);
    }
    return ogolny(c);
  }

  /** HP 0 habitatu: sektory dysku po kolei od strony upadku. Kotwice puszcza fala w wGrze.js. */
  function upadek(fx = 0, fy = -1) {
    const lista = [];
    const n = Hs.discSectors, kk = TAU / n;
    const aP = Math.atan2(-fy, fx);
    const s0 = Math.round(aP / kk);
    const kol = [s0];
    for (let e = 1; kol.length < n; e++) { kol.push(s0 + e); if (kol.length < n) kol.push(s0 - e); }
    for (let e = 0; e < n; e++) sektor(kol[e] * kk, (5 * e) / n, lista);
    return { lista };
  }

  /** Nazwy części wokseli, które przy zgniocie kawałka tracą kotwice: wieżowiec miasta (część o tym samym id). Inne kawałki: nic. */
  const czesciZgniotu = (id) => (l.chunkById?.get(id)?.kind === 'highrise' ? [id] : []);

  return { szukaj, kawalek, czesciZgniotu, przewrot, naZewnatrz, czesciUpadku, szyja, kikut, upadek, szyjaZ, szyjaR: Hs.neckR };
}
