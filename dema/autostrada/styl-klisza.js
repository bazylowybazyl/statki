// dema/autostrada/styl-klisza.js
//
// STYL „KLISZA” — droga na długim czasie naświetlania: świeci to, co przejechało. Każdy pojazd ciągnie dwa włosy światła (lewe i
// prawe światło, odstęp mówi o szerokości kadłuba), a włosy układają się w pasma o nierównej jasności. Stojący pojazd = krótki czerwony
// koralik. ŚLAD IDZIE PRAWDZIWYM TOREM: pasek instancji czyta historię pozycji pojazdu z bufora storage (ruch.hist), więc zmiana pasa i
// rampa nie wyginają ogona (dawniej sztywny łuk z bieżącej krzywizny). Kolor: wg jednostki albo wg kierunku jazdy (ctx.barwySladow),
// widoczność: ctx.slady ('daleko' — ślady gasną przy zbliżaniu, 'pelne', 'brak'). Z daleka drogę niesie rzeka z pola gęstości.
import * as THREE from 'three/webgpu';
import {
  attribute, float, vec2, vec3, vec4, max, abs, mix, sin, cos, exp, clamp, smoothstep, varying, positionGeometry, fwidth, step, texture,
  positionLocal, length, atan, select, PI2, storage, uniform, floor, fract, mod
} from 'three/tsl';
import { U, sladPikselaW, materialAddytywny, BARWY, kolor, linia, przerywana } from './wspolne.tsl.js';
import { HW } from './siec.js';
import { HIST } from './ruch.js';
import { zbierzZakres, zbierzCaly } from '../../src/3d/zakresyWysylki.js';

const POJEMNOSC = 6144;
const STRIDE = 16;
const SEG = 22;

// Włosy: właściwa grubość smugi [j.], zysk, mnożnik czasu.
const STRUGA = Object.freeze([
  { sigma: 1.9, zysk: 1.0, t: 1.0 },    // ciężarówka
  { sigma: 1.4, zysk: 0.72, t: 1.0 },   // prom (workforce): najcieńsze włosy
  { sigma: 1.6, zysk: 1.3, t: 0.6 },    // policja
  { sigma: 8.0, zysk: 0.5, t: 1.1 },    // turystyka: szeroki jedwab
  { sigma: 3.0, zysk: 1.15, t: 1.0 },   // kontenerowiec
  { sigma: 4.0, zysk: 1.3, t: 1.1 },    // dalekobieżny
  { sigma: 4.0, zysk: 1.3, t: 1.1 },    // tankowiec
  { sigma: 6.0, zysk: 2.2, t: 1.0 },    // ciężki
  { sigma: 7.0, zysk: 2.6, t: 1.0 }     // mega
]);

// Kolor śladu wg jednostki (kod klasy). Czerwień zastrzeżona dla stopu, więc turystyka idzie w fiolet.
const BARWA_KLASY = Object.freeze([
  Object.freeze([1.0, 0.42, 0.06]),     // ciężarówka: bursztyn
  Object.freeze([1.0, 0.86, 0.62]),     // workforce: ciepła biel okien
  Object.freeze([0.5, 0.9, 3.0]),       // policja (kreski — osobno)
  Object.freeze([0.82, 0.42, 1.0]),     // turystyka: fiolet
  Object.freeze([0.40, 0.66, 1.0]),     // kontenerowiec: stalowy błękit
  Object.freeze([0.66, 0.82, 1.0]),     // dalekobieżny: zimna biel
  Object.freeze([0.2, 0.86, 0.7]),      // tankowiec: morski
  Object.freeze([0.85, 0.9, 1.0]),      // ciężki
  Object.freeze([1.0, 0.95, 0.85])      // mega
]);
const luminancja = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
// Szczyt pod progiem bloomu: włos jest cieńszy niż 3 px, więc zysk × luminancja ≤ 0,8.
const limitZysku = (c) => 0.8 / Math.max(0.05, luminancja(c));

function zbudujGeometrie() {
  // Pasek: u = 0 (głowa) … 1 (ogon), v = ±1. Gęściej przy głowie, bo tam najszybciej gaśnie.
  const pos = [];
  const idx = [];
  for (let i = 0; i <= SEG; i++) {
    const u = Math.pow(i / SEG, 1.5);
    pos.push(u, 1, 0, u, -1, 0);
  }
  for (let i = 0; i < SEG; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  const bufor = new THREE.InstancedInterleavedBuffer(new Float32Array(POJEMNOSC * STRIDE), STRIDE, 1);
  bufor.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('iPoza', new THREE.InterleavedBufferAttribute(bufor, 4, 0));    // x, y, kurs, krzywizna
  g.setAttribute('iSmuga', new THREE.InterleavedBufferAttribute(bufor, 4, 4));   // długość [j.], sigma, zysk, hamowanie
  g.setAttribute('iBarwa', new THREE.InterleavedBufferAttribute(bufor, 4, 8));   // r, g, b, kreski policji (1 + przebieg; 0 — nie)
  g.setAttribute('iHist', new THREE.InterleavedBufferAttribute(bufor, 4, 12));   // slot (−1: łuk bez historii), wiek głowy, czas ogona, odsunięcie włosa
  g.instanceCount = 0;
  return { g, bufor };
}

function zbudujMaterial(atrybutHistorii, uWiersz, uWiek) {
  const iPoza = attribute('iPoza', 'vec4');
  const iSmuga = attribute('iSmuga', 'vec4');
  const iBarwa = attribute('iBarwa', 'vec4');
  const iHist = attribute('iHist', 'vec4');
  const u = positionGeometry.x;
  const bok = positionGeometry.y;

  const hist = storage(atrybutHistorii, 'vec2', HIST.SLOTY * HIST.WIERSZE).toReadOnly().setName('autostradaHist');
  const slot = max(iHist.x, 0);
  const W = float(HIST.WIERSZE);
  const wiersz = (i) => hist.element(mod(uWiersz.sub(i).add(W), W).mul(HIST.SLOTY).add(slot).toInt());
  const glowa = iPoza.xy;
  // Punkt toru sprzed `wiek` sekund: między głową a najnowszym wierszem, dalej między wierszami historii.
  const punkt = (wiek) => {
    const a = wiek.sub(uWiek).div(HIST.DT);
    const aDod = max(a, 0);
    const i = floor(aDod);
    const zHistorii = mix(wiersz(i), wiersz(i.add(1)), fract(aDod));
    const zGlowy = mix(glowa, wiersz(float(0)), clamp(wiek.div(max(uWiek, 1e-3)), 0, 1));
    return mix(zGlowy, zHistorii, step(0, a));
  };
  const wiek = iHist.y.add(u.mul(iHist.z));
  const pH = punkt(wiek);
  const pH2 = punkt(wiek.add(0.05));

  // Kurs głowy na wypadek stojącego ogona (wszystkie punkty w jednym miejscu).
  const h = iPoza.z;
  const tx = cos(h);
  const ty = sin(h);
  const dH = pH.sub(pH2);
  const lH = length(dH);
  const tH = mix(vec2(tx, ty), dH.div(max(lH, 1e-3)), smoothstep(0.1, 1.5, lH));

  // Łuk bez historii: koralik stojącego pojazdu i ślad Atlasa (szereg — bez gałęzi).
  const L = iSmuga.x;
  const d = u.mul(L);
  const th = clamp(iPoza.w.mul(d), -1.4, 1.4);
  const th2 = th.mul(th);
  const A = float(1).sub(th2.div(6)).add(th2.mul(th2).div(120));
  const B = th.mul(0.5).sub(th.mul(th2).div(24)).add(th.mul(th2).mul(th2).div(720));
  const pA = vec2(iPoza.x.sub(tx.mul(d).mul(A)).sub(ty.mul(d).mul(B)), iPoza.y.sub(ty.mul(d).mul(A)).add(tx.mul(d).mul(B)));
  const hTu = h.sub(th);
  const tA = vec2(cos(hTu), sin(hTu));

  const zHist = step(-0.5, iHist.x);
  const p = mix(pA, pH, zHist);
  const t = mix(tA, tH, zHist);
  const n = vec2(t.y.negate(), t.x);

  const slad = sladPikselaW(vec3(p, 0));
  const sigma = max(iSmuga.y, slad.mul(0.9));
  const rozmach = sigma.mul(3.2);
  const pozycja = vec3(p.add(n.mul(iHist.w.add(bok.mul(rozmach)))), 0);

  const vY = varying(bok.mul(rozmach), 'vY');
  const vU = varying(u, 'vU');
  const vDl = varying(L, 'vDl');
  const vSig = varying(sigma, 'vSig');
  const vSig0 = varying(iSmuga.y, 'vSig0');
  const vZysk = varying(iSmuga.z, 'vZysk');
  const vBarwa = varying(iBarwa, 'vBarwa');
  const vHam = varying(iSmuga.w, 'vHam');

  // Fragment: Gauss w poprzek z zachowaną całką (dolny próg: z daleka włos nie ginie do zera) × zanik wzdłuż, miękkie czoło.
  const y = vY.div(vSig);
  const poprzek = exp(y.mul(y).mul(-0.5)).mul(max(vSig0.div(vSig), 0.16));
  const wzdluz = exp(vU.mul(-3.2)).mul(smoothstep(0, 0.012, vU.add(0.002)));
  const rdzen = exp(vU.mul(vDl).div(max(vSig.mul(2.5), 18)).negate());
  const jasnosc = poprzek.mul(wzdluz.add(rdzen.mul(vHam).mul(0.9))).mul(vZysk);
  const barwaZwykla = mix(vBarwa.rgb, kolor(BARWY.stop).mul(0.16), vHam);
  // Policja: przerywana kreska niebieska i czerwona; kreski STOJĄ w świecie, więc ekran nie miga. iBarwa.a = 1 + przebieg mod okres.
  const dPol = vU.mul(vDl);
  const fwPol = fwidth(dPol);
  const okres = float(1400);
  const przes = dPol.sub(vBarwa.a.sub(1));
  const kBlekit = przerywana(przes, okres, 0.2, fwPol);
  const kCzerw = przerywana(przes.add(okres.mul(0.5)), okres, 0.2, fwPol);
  const barwaPol = vec3(0.5, 0.9, 3.0).mul(kBlekit).add(vec3(3.2, 0.12, 0.08).mul(kCzerw)).mul(0.62);
  const barwa = mix(barwaZwykla, barwaPol, step(0.5, vBarwa.a));
  const wyjscie = clamp(barwa.mul(jasnosc), vec3(0), vec3(4));
  return materialAddytywny(vec4(wyjscie, 1), pozycja, 'klisza-komety');
}

// Rzeka (z daleka) i pamięć drogi: wstęga jezdni czyta pole gęstości; trzy pasy jako wiązki o jasności z gęstości.
function zbudujRzeke(ctx, uJednostki) {
  const pole = ctx.pole.tekstura;
  const aSV = attribute('aSV', 'vec2');
  const aMeta = attribute('aMeta', 'vec4');
  const vV = varying(aSV.y, 'vRzV');
  const vM = varying(aMeta, 'vRzM');
  const vP = varying(positionLocal.xy, 'vRzP');
  const rodzaj = vM.x;
  const r = length(vP);
  const fw = fwidth(r);
  const kat = atan(vP.y, vP.x).div(PI2);
  const u01 = kat.sub(floor(kat));
  const glowna = float(1).sub(step(1.5, rodzaj));
  const nazew = step(0.5, rodzaj);          // 1 — zewnętrzna
  const pasy = [
    { rW: HW.iL1, rZ: HW.oL1, sz: 150, w: 0.5, barwa: vec3(0.72, 0.8, 1.0) },
    { rW: HW.iL2, rZ: HW.oL2, sz: 150, w: 1.5, barwa: vec3(0.42, 0.68, 1.0) },
    { rW: HW.iL3, rZ: HW.oL3, sz: 90, w: 2.5, barwa: vec3(1.0, 0.52, 0.13) }
  ];
  const barwaKier = mix(kolor(BARWY.ciepla), kolor(BARWY.zimna), nazew);
  let rzeka = vec3(0);
  let gorac = float(0);
  for (const p of pasy) {
    const rc = mix(float(p.rW), float(p.rZ), nazew);
    const wiersz = nazew.mul(3).add(p.w).div(6);
    const pr = texture(pole, vec2(u01, wiersz)).level(0);
    const d = r.sub(rc);
    const sz = float(p.sz).mul(0.45);
    const sig = max(sz, fw.mul(0.9));
    const bok = exp(d.mul(d).div(sig.mul(sig)).mul(-0.5)).mul(sz.div(sig));
    const gest = pr.r.mul(5).clamp(0, 2.5);
    rzeka = rzeka.add(mix(barwaKier, p.barwa, uJednostki).mul(bok).mul(gest));
    gorac = gorac.add(bok.mul(pr.b.mul(5).clamp(0, 2.5)));
  }
  // Rzeka: tylko z daleka (poniżej zoomu ~0,05), bliżej niosą ją włosy — inaczej pole wygląda jak dym.
  const blisko = smoothstep(0.07, 0.018, U.zoom);
  const korek = kolor(BARWY.stop).mul(gorac).mul(0.1).mul(blisko.mul(0.8).add(0.05));
  // Pamięć drogi: krawędzie jezdni 1–2 px; rampy słabiej; pasy K-7 tylko w fazie przejazdu; drogi ciężkich ledwie.
  const krawedz = linia(abs(vV).sub(vM.y), float(5), fw);
  const fazaK7 = U.sygnaly.element(aMeta.w.max(0).toInt()).w;
  const vBox = varying(step(1.5, fazaK7).mul(float(1).sub(step(3.5, fazaK7))), 'vRzBox');
  const wagaRamp = select(rodzaj.lessThan(1.5), float(1),
    select(rodzaj.lessThan(2.5), float(0),
      select(rodzaj.lessThan(7.5), float(0.32),
        select(rodzaj.lessThan(8.5), vBox.mul(1.1), float(0.05)))));
  const pamiec = vec3(0.05, 0.058, 0.068).mul(krawedz).mul(wagaRamp);
  const wyj = rzeka.mul(0.42).mul(blisko).add(korek).mul(glowna).add(pamiec);
  const m = materialAddytywny(vec4(clamp(wyj, vec3(0), vec3(3)), 1), null, 'klisza-rzeka');
  const mesh = new THREE.Mesh(ctx.geomWstegi, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = 'KliszaRzeka';
  return mesh;
}

export function utworzKlisze(ctx) {
  const { g, bufor } = zbudujGeometrie();
  const hist = ctx.ruch.hist;
  const atrHist = new THREE.StorageBufferAttribute(hist.dane, 2);
  const uWiersz = uniform(0).setName('uKlWiersz');
  const uWiek = uniform(0).setName('uKlWiek');
  const uJednostki = uniform(1).setName('uKlJednostki');
  const mesh = new THREE.Mesh(g, zbudujMaterial(atrHist, uWiersz, uWiek));
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.name = 'KliszaKomety';
  ctx.grupa.add(mesh);
  const rzeka = zbudujRzeke(ctx, uJednostki);
  ctx.grupa.add(rzeka);
  const dane = bufor.array;
  const C = BARWY.zimna;
  const W = BARWY.ciepla;
  const JEDWAB_Z = [0.86, 0.72, 0.59];
  const JEDWAB_W = [1.0, 0.58, 0.27];
  const barwaMieszana = [0, 0, 0];
  let atlasDl = 0;
  let atlasAlfa = 0;
  let atlasX = 0;
  let atlasY = 0;
  let atlasH = 0;
  let wersjaHistorii = -1;
  let n = 0;
  const wpisz = (x, y, h, kr, dl, sigma, zysk, ham, b, pol, slot, wiek0, czas, off) => {
    if (n >= POJEMNOSC) return;
    const o = n * STRIDE;
    dane[o] = x; dane[o + 1] = y; dane[o + 2] = h; dane[o + 3] = kr;
    dane[o + 4] = dl; dane[o + 5] = sigma; dane[o + 6] = zysk; dane[o + 7] = ham;
    dane[o + 8] = b[0]; dane[o + 9] = b[1]; dane[o + 10] = b[2]; dane[o + 11] = pol;
    dane[o + 12] = slot; dane[o + 13] = wiek0; dane[o + 14] = czas; dane[o + 15] = off;
    n++;
  };

  return {
    id: 'klisza',
    nazwa: 'Klisza',
    opis: 'długi czas naświetlania: droga z tego, co przejechało',
    siatki: [mesh, rzeka],
    podklad: 0.72,
    aktualizuj(kl) {
      const ruch = ctx.ruch;
      // Wysyłka historii: jeden nowy wiersz — zakres; po przerwie albo przewinięciu — całość.
      const nowe = hist.wersja - wersjaHistorii;
      if (nowe === 1) zbierzZakres(atrHist, hist.wiersz * HIST.SLOTY * 2, HIST.SLOTY * 2);
      else if (nowe > 1) zbierzCaly(atrHist);
      wersjaHistorii = hist.wersja;
      uWiersz.value = hist.wiersz;
      uWiek.value = Math.max(0, ruch.czas + (kl.tau || 0) - hist.tWiersza);
      const wgJednostek = ctx.barwySladow !== 'kierunek';
      uJednostki.value = wgJednostek ? 1 : 0;

      const z = Math.max(kl.zoom, 1e-3);
      // Czas naświetlania: długi z daleka, krótki z bliska (przy 1 px/j. smuga 1:1 wyglądałaby jak strzał).
      const maksT = (HIST.WIERSZE - 2) * HIST.DT - 0.9;
      const T = Math.max(0.3, Math.min(maksT, (1.05 / Math.sqrt(z)) * Math.min(1, Math.max(0.42, 1.25 - z * 2.1))));
      // Tryb śladów: „z daleka” gasi je przy zoomie 0,12–0,32 (tam obraz niosą kadłuby i lampy).
      let udzial = 1;
      if (ctx.slady === 'brak') udzial = 0;
      else if (ctx.slady === 'daleko' && kl.gra) {
        const q = Math.max(0, Math.min(1, (0.32 - z) / 0.2));
        udzial = q * q * (3 - 2 * q);
      }
      const lista = ruch.pojazdy;
      n = 0;
      if (udzial > 0.002) {
        for (let i = 0; i < lista.length; i++) {
          const v = lista[i];
          if (v.alfa <= 0.01 || v.slot < 0) continue;
          const st = STRUGA[v.kod];
          const hash = v.hash;
          const los = 0.42 + 1.5 * hash * hash * hash;   // kilka mocnych, wiele włosów
          let b;
          if (wgJednostek) {
            const k0 = BARWA_KLASY[v.kod];
            const kier = v.cw === 1 ? C : W;
            // Odrobina barwy kierunku: te same jednostki na obu jezdniach nadal różnią się ciepłem.
            barwaMieszana[0] = k0[0] * 0.85 + kier[0] * 0.15;
            barwaMieszana[1] = k0[1] * 0.85 + kier[1] * 0.15;
            barwaMieszana[2] = k0[2] * 0.85 + kier[2] * 0.15;
            b = barwaMieszana;
          } else {
            b = v.kod === 3 ? (v.cw === 1 ? JEDWAB_Z : JEDWAB_W) : (v.cw === 1 ? C : W);
          }
          // Jasność rośnie, gdy pojazd zwalnia (ta sama energia na krótszej smudze), z sufitem pod progiem bloomu.
          const zwolnienie = Math.min(2.2, 1 / Math.max(0.33, v.vel / 900));
          const zysk = Math.min(limitZysku(b), st.zysk * los * zwolnienie * (v.kod === 0 ? 0.55 + v.n * 0.15 : 1)) * v.alfa * udzial;
          const stoi = v.tryb === 0 && v.vel < 60 ? 1 : (v.hamuje ? 0.35 : 0);
          const dl = Math.max(v.vel * T * st.t, 60);
          // Ślad zaczyna się za rufą (ciężarówka: za ostatnim kontenerem): rufa była tu przed chwilą.
          const zaRufa = v.kod === 0 ? 16 + v.n * 35 : v.L * 0.5;
          const wiek0 = Math.min(1, zaRufa / Math.max(v.vel, 80));
          const czas = Math.min(T * st.t, ruch.czas - v.urodzony - wiek0, maksT);
          if (czas > 0.05) {
            const szer = v.k.W * 0.34;
            if (v.kod === 2) {
              wpisz(v.x, v.y, v.h, v.kr, Math.max(dl, 400), st.sigma * 1.2, 1.1 * v.alfa * udzial, stoi, b, 1 + (v.d % 1400), v.slot, wiek0, czas, 0);
            } else {
              wpisz(v.x, v.y, v.h, v.kr, dl, st.sigma, zysk, stoi, b, 0, v.slot, wiek0, czas, szer);
              wpisz(v.x, v.y, v.h, v.kr, dl, st.sigma * 0.85, zysk * 0.7, stoi, b, 0, v.slot, wiek0, czas * (0.72 + hash * 0.28), -szer);
            }
          }
          // Koralik stojącego pojazdu: krótka czerwona kreska za rufą (historia ma wtedy zerową długość).
          if (v.tryb === 0 && v.vel < 60) {
            wpisz(v.x - Math.cos(v.h) * zaRufa, v.y - Math.sin(v.h) * zaRufa, v.h, 0, 60, st.sigma, Math.min(1, zysk * 1.4), 1, W, 0, -1, 0, 0, 0);
          }
        }
      }
      // Ślad Atlasa: nitki z dysz w poprzek drogi, gasną powoli po przejściu (znak przejazdu, nie ruch drogi).
      const a = ruch.atlas;
      if (a.stan === 'lot') {
        atlasDl = Math.min(16000, Math.max(0, a.z - 7400));
        atlasAlfa = 1;
        atlasX = a.xs; atlasY = a.ys; atlasH = a.kat;
      } else if (atlasAlfa > 0) {
        atlasAlfa = Math.max(0, atlasAlfa - kl.dt / 14);
      }
      if (atlasAlfa > 0 && atlasDl > 100 && ctx.slady !== 'brak') {
        const nx = -Math.sin(atlasH);
        const ny = Math.cos(atlasH);
        for (const [o, j] of [[-300, 0.9], [-110, 1.15], [110, 1.15], [300, 0.9]]) {
          wpisz(atlasX + nx * o - Math.cos(atlasH) * 850, atlasY + ny * o - Math.sin(atlasH) * 850, atlasH, 0, atlasDl, 6, 0.75 * j * atlasAlfa, 0, BARWY.korytarz, 0, -1, 0, 0, 0);
        }
      }
      g.instanceCount = n;
      bufor.needsUpdate = true;
    }
  };
}
