// Strona na żywo dema wiązanych wokseli: pętla rAF, kamera orbitalna, panel (docs/SPEC-woksele-zawalenia.md § 5.2–5.4). Efekt od razu po wejściu, bez nakładek w kadrze.
// Zegar stały 1/60 s na krok, najwyżej 2 kroki na klatkę, po przekroczeniu progu 1 krok, reszta przepada: spowolnienie zamiast spirali. Numer kroku z licznika całkowitego.
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createWokseleObraz } from './obraz.js';
import { OPCJE_PYLU } from './pyl.js';

const H = 1 / 60;
const STANIE_POMIJANE = 60; // § 5.2: stanie przed zdarzeniem skrócone o sekundę; stojąca wieża się nie rusza (W1), więc kroki idą od razu przy resecie
const PROG_DRUGIEGO_KROKU_MS = 14;
const DROGA_MIGAWEK = '/.tmp/woksele-demo/migawki/';

// Kamery startowe jak w filmie (bieg-film.sh, § 4.7): az, el, cel, odl. Cień: środek i zakres z rys4.mjs.
const K_WIEZA = { az: 32, el: 8, cel: [0, 0, 620], odl: 3300 };
// S5 (§ 5.5): kamery jak w filmie. Zakres cienia w Node 7000 to cała szerokość mapy, tu połowa. zaSrodkiem: kamera i cień jadą stałą prędkością ze środkiem masy z chwili t = 0, cel kamery względem niego.
const K_S5 = { az: 32, el: 15, cel: [0, 0, -650], odl: 7200 };
const SCENY = {
  S5: { nazwa: 'S5 pochylona wieża', kamera: K_S5, cien: [[0, 0, -900], 3500], pomin: 0 },
  S5v: { nazwa: 'S5 próżnia', kamera: { az: 32, el: 20, cel: [0, 0, 0], odl: 7600 }, cien: [[0, 0, 0], 3500], pomin: 0, zaSrodkiem: true },
  S5p: { nazwa: 'S5 planeta', kamera: K_S5, cien: [[0, 0, -900], 3500], pomin: 0 },
  S1: { nazwa: 'S1 podcięcie', kamera: K_WIEZA, cien: [[0, 0, 500], 1700], pomin: STANIE_POMIJANE },
  S2: { nazwa: 'S2 własny ciężar', kamera: K_WIEZA, cien: [[0, 0, 500], 1700], pomin: STANIE_POMIJANE },
  S3: { nazwa: 'S3 przebicie dysku', kamera: { az: 35, el: 22, cel: [0, 0, -250], odl: 3400 }, cien: [[0, 0, -300], 2300], pomin: 0 },
  S4: { nazwa: 'S4 próżnia', kamera: { az: 32, el: 8, cel: [0, 0, 650], odl: 6200 }, cien: [[0, 0, 650], 3500], pomin: STANIE_POMIJANE },
  S4grunt: { nazwa: 'S4 przy g = 400', kamera: K_WIEZA, cien: [[0, 0, 650], 3500], pomin: STANIE_POMIJANE },
  krater: { nazwa: 'Krater', kamera: { az: 60, el: 6, cel: [190, 0, 600], odl: 750 }, cien: [[0, 0, 500], 1700], pomin: 0 },
  odpornosc: { nazwa: 'Odporność', kamera: K_WIEZA, cien: [[0, 0, 500], 1700], pomin: STANIE_POMIJANE },
  kolumna: { nazwa: 'Kolumna', kamera: K_WIEZA, cien: [[0, 0, 500], 1700], pomin: STANIE_POMIJANE },
  naroznik: { nazwa: 'Narożnik', kamera: K_WIEZA, cien: [[0, 0, 500], 1700], pomin: STANIE_POMIJANE },
  krater90: { nazwa: 'Krater r = 90, próżnia', kamera: { az: 60, el: 6, cel: [190, 0, 650], odl: 1500 }, cien: [[0, 0, 650], 3500], pomin: 0 },
  S3poza: { nazwa: 'S3 poza środkiem', kamera: { az: 35, el: 22, cel: [0, 0, -250], odl: 3400 }, cien: [[0, 0, -300], 2300], pomin: 0 },
  S3osm: { nazwa: 'S3 ośmiokąt', kamera: { az: 35, el: 22, cel: [0, 0, -250], odl: 3400 }, cien: [[0, 0, -300], 2300], pomin: 0 },
};
const TEMPA = [[1, '1×'], [0.5, '½×'], [0.25, '¼×'], [0.125, '⅛×']];

function ustawKamere(camera, sterowanie, k) {
  const a = (k.az * Math.PI) / 180, e = (k.el * Math.PI) / 180;
  camera.position.set(
    k.cel[0] + Math.sin(a) * Math.cos(e) * k.odl,
    k.cel[1] - Math.cos(a) * Math.cos(e) * k.odl,
    k.cel[2] + Math.sin(e) * k.odl,
  );
  if (sterowanie) { sterowanie.target.set(k.cel[0], k.cel[1], k.cel[2]); sterowanie.update(); } else camera.lookAt(k.cel[0], k.cel[1], k.cel[2]);
  camera.updateMatrixWorld();
}

export async function startPokaz({ renderer, solver, wok, device, adres }) {
  const kanwa = renderer.domElement;
  kanwa.id = 'kanwa';
  document.body.appendChild(kanwa);
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 20, 700000);
  camera.up.set(0, 0, 1);

  const obraz = createWokseleObraz({ solver, camera, aoTryb: adres.get('ao') || 'film' });
  const sterowanie = new OrbitControls(camera, kanwa);
  sterowanie.enableDamping = true;
  sterowanie.dampingFactor = 0.12;
  sterowanie.maxDistance = 30000;
  sterowanie.minDistance = 60;
  sterowanie.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  sterowanie.zoomToCursor = true;

  const stan = { scena: null, krok: 0, pauza: false, tempo: 1, akum: 0, kroczyc: true, msKlatki: 0, ostatnia: 0, licznik: false, pierwszyKrok: false, jedzie: false, c0x: 0, c0y: 0, c0z: 0, vcx: 0, vcy: 0, vcz: 0, ocx: 0, ocy: 0, ocz: 0 };

  function krokSceny() {
    if (stan.krok >= stan.pelnyOd) { obraz.pelnyObraz(true); stan.pelnyOd = Infinity; }
    solver.krok(renderer);
    if (stan.pierwszyKrok) { obraz.krokBezLimitu(renderer); stan.pierwszyKrok = false; } else obraz.krok(renderer);
    stan.krok++;
  }

  // Budowa raz na scenę w wątku roboczym (§ 2.3), reset to tylko wgranie buforów. Sceny budują się w tle po starcie, więc przełączenie ich nie czeka.
  const ziarnoAdresu = adres.has('ziarno') ? Number(adres.get('ziarno')) : undefined;
  const watek = new Worker(new URL('./budowa.worker.js', import.meta.url), { type: 'module' });
  const wypieki = new Map();
  const czekajace = new Map();
  watek.onmessage = ({ data }) => {
    const c = czekajace.get(data.id);
    if (data.blad) { console.error('woksele: budowa sceny', data.id, data.blad); c?.nie(new Error(data.blad)); return; }
    wypieki.set(data.id, data);
    c?.ok(data);
  };
  function wypiek(id) {
    if (wypieki.has(id)) return Promise.resolve(wypieki.get(id));
    if (!czekajace.has(id)) {
      const c = {};
      c.obietnica = new Promise((ok, nie) => { c.ok = ok; c.nie = nie; });
      czekajace.set(id, c);
      watek.postMessage({ id, ziarno: ziarnoAdresu });
    }
    return czekajace.get(id).obietnica;
  }
  /** Wejście w scenę z panelu: czeka na budowę, ostatni klik wygrywa. */
  async function wejdz(id, opcje) {
    stan.celScena = id;
    await wypiek(id);
    if (stan.celScena === id) ustawScene(id, opcje);
  }

  /** Scena przez reset: wgranie buforów, bez nowych pipeline'ów. Kamera tylko przy zmianie sceny, R zostawia ją tam, gdzie jest. */
  function ustawScene(id, { kamera = true, pomin = true } = {}) {
    const opis = SCENY[id];
    if (!opis) throw new Error(`Nieznana scena ${id}`);
    const { w, g, zdarzeniaOd, rDysk, poklad } = wypieki.get(id);
    solver.wczytaj(w);
    solver.ustawPlan(g);
    obraz.wczytaj(w, { rDysk, poklad, pyl: OPCJE_PYLU[id] });
    obraz.ustawCien(opis.cien[0], opis.cien[1]);
    stan.scena = id;
    stan.krok = 0;
    stan.akum = 0;
    stan.pelnyOd = Number.isFinite(zdarzeniaOd) ? Math.max(0, Math.floor(zdarzeniaOd * 60) - 1) : 0;
    if (pomin) for (let k = 0; k < opis.pomin; k++) krokSceny();
    stan.jedzie = false;
    if (opis.zaSrodkiem) {
      // Środek masy i jego prędkość z chwili t = 0, raz na wejście w scenę.
      let sx = 0, sy = 0, sz = 0, vx = 0, vy = 0, vz = 0;
      const v0 = w.vel0;
      for (let i = 0; i < w.n; i++) {
        sx += w.pos[3 * i]; sy += w.pos[3 * i + 1]; sz += w.pos[3 * i + 2];
        if (v0) { vx += v0[3 * i]; vy += v0[3 * i + 1]; vz += v0[3 * i + 2]; }
      }
      stan.jedzie = true;
      stan.c0x = sx / w.n; stan.c0y = sy / w.n; stan.c0z = sz / w.n;
      stan.vcx = vx / w.n; stan.vcy = vy / w.n; stan.vcz = vz / w.n;
      if (kamera) { stan.ocx = 0; stan.ocy = 0; stan.ocz = 0; }
    }
    if (kamera) {
      const k = opis.kamera;
      ustawKamere(camera, sterowanie, opis.zaSrodkiem ? { ...k, cel: [k.cel[0] + stan.c0x, k.cel[1] + stan.c0y, k.cel[2] + stan.c0z] } : k);
    }
    zaznacz();
    return w;
  }

  /** Kamera i cień za środkiem masy (S5 próżnia): przesunięcie względem poprzedniej klatki, więc orbita i przybliżenie użytkownika zostają. Reset wraca na początek toru. Bez alokacji. */
  const srodekCienia = [0, 0, 0];
  function sledzSrodek() {
    if (!stan.jedzie) return;
    const t = stan.krok * H + stan.akum;
    const ox = stan.vcx * t, oy = stan.vcy * t, oz = stan.vcz * t;
    const dx = ox - stan.ocx, dy = oy - stan.ocy, dz = oz - stan.ocz;
    stan.ocx = ox; stan.ocy = oy; stan.ocz = oz;
    camera.position.x += dx; camera.position.y += dy; camera.position.z += dz;
    sterowanie.target.x += dx; sterowanie.target.y += dy; sterowanie.target.z += dz;
    const c = SCENY[stan.scena].cien;
    srodekCienia[0] = c[0][0] + stan.c0x + ox; srodekCienia[1] = c[0][1] + stan.c0y + oy; srodekCienia[2] = c[0][2] + stan.c0z + oz;
    obraz.ustawCien(srodekCienia, c[1]);
  }

  /** Migawka Node (S1_t3.50), dopóki pakiet P2 nie ma zdarzeń: stan z chwili t, dalej swobodny bieg. */
  async function wgrajMigawke(nazwa) {
    const { rozpakujMigawke } = await import('./wzorzec-cpu.js');
    const [rj, rb] = await Promise.all([fetch(`${DROGA_MIGAWEK}${nazwa}.json`), fetch(`${DROGA_MIGAWEK}${nazwa}.bin`)]);
    if (!rj.ok || !rb.ok) throw new Error(`Brak migawki ${nazwa}`);
    const m = rozpakujMigawke(await rj.json(), await rb.arrayBuffer());
    await wypiek(nazwa.split('_')[0]);
    ustawScene(nazwa.split('_')[0]);
    solver.wgraj({ ...m.przed, skG: m.skG, sFr: m.sFr, kotwiceWiezy: m.kotwiceWiezy, budowa: m.budowa });
    obraz.krokBezLimitu(renderer);
    obraz.pelnyObraz(true);
    stan.pelnyOd = Infinity;
    stan.krok = Math.round(Number(nazwa.split('_t')[1]) * 60);
  }

  function zmienRozmiar() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    obraz.ustawRozmiar(renderer, w, h);
  }

  // ── Panel ──
  const panel = document.getElementById('panel');
  const przyciski = new Map();
  const dodaj = (rodzic, tekst, akcja, klucz) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = tekst;
    b.addEventListener('click', () => { akcja(); b.blur(); });
    rodzic.appendChild(b);
    if (klucz) przyciski.set(klucz, b);
    return b;
  };
  const gr1 = document.getElementById('panelSceny');
  const gr2 = document.getElementById('panelTempo');
  const gr3 = document.getElementById('panelSter');
  for (const id of Object.keys(SCENY)) {
    const b = dodaj(gr1, SCENY[id].nazwa, () => { wejdz(id); }, `s:${id}`);
    b.disabled = !zdarzeniaDostepne(id);
  }
  for (const [t, opis] of TEMPA) dodaj(gr2, opis, () => { stan.tempo = t; zaznacz(); }, `t:${t}`);
  dodaj(gr3, 'Reset (R)', () => ustawScene(stan.scena, { kamera: false }));
  const bPauza = dodaj(gr3, 'Pauza (spacja)', () => { stan.pauza = !stan.pauza; zaznacz(); });
  function zaznacz() {
    for (const [k, b] of przyciski) {
      const wl = k === `s:${stan.scena}` || k === `t:${stan.tempo}`;
      b.classList.toggle('wl', wl);
    }
    bPauza.classList.toggle('wl', stan.pauza);
  }
  /** Sceny ze zdarzeniami potrzebują kerneli pakietu P2, S3 zdarzeń nie ma. */
  function zdarzeniaDostepne(id) { return id === 'S3' || !!solver.kernele.kCzas; }
  panel.hidden = false;

  const licznik = document.getElementById('licznik');
  window.addEventListener('resize', zmienRozmiar);
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Space') { stan.pauza = !stan.pauza; zaznacz(); e.preventDefault(); }
    else if (e.code === 'KeyR') ustawScene(stan.scena, { kamera: false });
    else if (e.code === 'KeyP') { stan.licznik = !stan.licznik; licznik.hidden = !stan.licznik; }
    else if (e.code === 'KeyH') panel.hidden = !panel.hidden;
  });

  // ── Start ── Rozgrzewka przed pierwszą klatką, potem efekt od razu.
  const mig = adres.get('migawka');
  const start = adres.get('scena') || (solver.kernele.kCzas ? 'S5' : 'S3');
  const scenaStartu = mig ? mig.split('_')[0] : start;
  await wypiek(scenaStartu);
  ustawScene(scenaStartu, { pomin: false });
  zmienRozmiar();
  await obraz.rozgrzej(renderer);
  // Rozgrzewka szła na scenie bez kroków, pomijane kroki stania idą już po niej. Harness liczy czas sceny od zera.
  if (mig) await wgrajMigawke(mig);
  else if (!adres.has('bezPominiecia')) for (let k = 0; k < SCENY[stan.scena].pomin; k++) krokSceny();

  let srednia = 0, klatek = 0, tLicznika = 0;
  function petla(teraz) {
    requestAnimationFrame(petla);
    stan.klatek = (stan.klatek | 0) + 1;
    const dtMs = stan.ostatnia ? teraz - stan.ostatnia : 16.7;
    stan.ostatnia = teraz;
    if (!stan.pauza && stan.kroczyc) {
      stan.akum += Math.min(dtMs, 100) * 0.001 * stan.tempo;
      const maksKrokow = stan.msKlatki > PROG_DRUGIEGO_KROKU_MS ? 1 : 2;
      let k = 0;
      while (stan.akum >= H && k < maksKrokow) { krokSceny(); stan.akum -= H; k++; }
      if (stan.akum >= H) stan.akum = H * 0.999; // reszta przepada
    }
    sledzSrodek();
    sterowanie.update();
    if (stan.rysowac !== false) obraz.rysuj(renderer, camera, stan.akum);
    stan.msKlatki = dtMs;
    if (stan.licznik) {
      srednia += dtMs; klatek++;
      if (teraz - tLicznika > 250) {
        licznik.textContent = `${(srednia / klatek).toFixed(1)} ms`;
        srednia = 0; klatek = 0; tLicznika = teraz;
      }
    }
  }
  requestAnimationFrame(petla);
  for (const id of Object.keys(SCENY)) if (zdarzeniaDostepne(id)) wypiek(id);
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

  Object.assign(wok, {
    obraz,
    camera,
    pokaz: {
      stan,
      ustawScene,
      wejdz,
      wgrajMigawke,
      /** Harness: scena stoi w chwili t. Kroki bez czekania na rAF, kolejka GPU trzymana krótko. */
      async doChwili(t) {
        stan.kroczyc = false;
        const cel = Math.round(t * 60);
        if (stan.krok > cel) ustawScene(stan.scena, { kamera: false, pomin: false });
        let n = 0;
        while (stan.krok < cel) {
          krokSceny();
          if (++n % 8 === 0) await device.queue.onSubmittedWorkDone();
        }
        stan.akum = 0;
        await device.queue.onSubmittedWorkDone();
        await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
        await device.queue.onSubmittedWorkDone();
        return { krok: stan.krok };
      },
      kamera(k) { ustawKamere(camera, sterowanie, k); },
      panel(wid) { panel.hidden = !wid; },
      /** Harness: czas pełnej klatki w ściśle zamkniętej pętli (krok, obraz, rysunek, czekanie na GPU), n klatek od stanu bieżącego. */
      async diag() {
        stan.kroczyc = false;
        stan.rysowac = false;
        const czekaj = () => new Promise((ok) => setTimeout(ok, 400));
        await czekaj();
        await device.queue.onSubmittedWorkDone();
        const wy = {};
        wy.pusto = await wok.pokaz.zmierzKlatki(10, false, false);
        wy.krok = await wok.pokaz.zmierzKlatki(10, true, false);
        wy.rysunek = await wok.pokaz.zmierzKlatki(10, false, true);
        const sc = obraz.mesh.geometry.instanceCount;
        obraz.mesh.geometry.instanceCount = 2;
        wy.bezBrylGlownych = await wok.pokaz.zmierzKlatki(10, false, true);
        obraz.mesh.geometry.instanceCount = sc;
        const au = obraz.sun.shadow.autoUpdate;
        obraz.sun.shadow.autoUpdate = false;
        wy.bezOdswCienia = await wok.pokaz.zmierzKlatki(10, false, true);
        obraz.sun.shadow.autoUpdate = au;
        // Znaczniki czasu: kObraz + kGruz i wszystkie passy rysunku z zegara GPU, bez podłogi około 3 ms z onSubmittedWorkDone.
        const pr = [];
        for (let k = 0; k < 7; k++) pr.push(await wok.zmierzListe(obraz.listaObrazu));
        pr.sort((a, b) => a - b);
        wy.kObrazKGruzMs = pr[3];
        const backend = renderer.backend;
        const rys = [];
        for (let k = 0; k < 7; k++) {
          backend.trackTimestamp = true;
          obraz.rysuj(renderer, camera, 0);
          const ms = await renderer.resolveTimestampsAsync('render');
          backend.trackTimestamp = false;
          backend.timestampQueryPool?.render?.timestamps?.clear?.();
          rys.push(ms);
          await device.queue.onSubmittedWorkDone();
        }
        rys.sort((a, b) => a - b);
        wy.rysunekGpuMs = rys[3];
        stan.rysowac = true;
        return wy;
      },
      async zmierzKlatki(n = 60, zKrokiem = true, rysunek = true) {
        stan.kroczyc = false;
        const t = [], c = [];
        for (let k = 0; k < n; k++) {
          const t0 = performance.now();
          if (zKrokiem) krokSceny();
          if (rysunek) obraz.rysuj(renderer, camera, 0);
          c.push(performance.now() - t0);
          await device.queue.onSubmittedWorkDone();
          t.push(performance.now() - t0);
        }
        t.sort((a, b) => a - b);
        c.sort((a, b) => a - b);
        return { n, p50: t[n >> 1], p95: t[Math.floor(n * 0.95)], maks: t[n - 1], cpuP50: c[n >> 1], w: renderer.domElement.width, h: renderer.domElement.height, rysunki: renderer.info.render.drawCalls };
      },
      /** Harness: koszt całej klatki (zdarzenia, krok, obraz, rysunek). Ściana z n klatek w porcjach po 8, żeby czekanie na GPU nie dodawało swojej podłogi około 3 ms do każdej. GPU z sumy znaczników jednej klatki, compute i render osobno. */
      async kosztKlatki(n = 32, probek = 15) {
        stan.kroczyc = false;
        stan.rysowac = false;
        await new Promise((ok) => setTimeout(ok, 300));
        await device.queue.onSubmittedWorkDone();
        const krok0 = stan.krok;
        const t0 = performance.now();
        for (let k = 0; k < n; k++) {
          krokSceny();
          obraz.rysuj(renderer, camera, 0);
          if ((k + 1) % 8 === 0) await device.queue.onSubmittedWorkDone();
        }
        await device.queue.onSubmittedWorkDone();
        const scianaMs = (performance.now() - t0) / n;
        const backend = renderer.backend;
        const comp = [], rys = [];
        for (let k = 0; k < probek; k++) {
          backend.trackTimestamp = true;
          krokSceny();
          obraz.rysuj(renderer, camera, 0);
          comp.push(await renderer.resolveTimestampsAsync('compute'));
          rys.push(await renderer.resolveTimestampsAsync('render'));
          backend.trackTimestamp = false;
          backend.timestampQueryPool?.compute?.timestamps?.clear?.();
          backend.timestampQueryPool?.render?.timestamps?.clear?.();
          await device.queue.onSubmittedWorkDone();
        }
        comp.sort((a, b) => a - b);
        rys.sort((a, b) => a - b);
        const m = probek >> 1;
        stan.rysowac = true;
        return { scianaMs, computeGpuMs: comp[m], renderGpuMs: rys[m], gpuMs: comp[m] + rys[m], kroki: [krok0, stan.krok], w: renderer.domElement.width, h: renderer.domElement.height, rysunki: renderer.info.render.drawCalls };
      },
      /** Harness: koszt pyłu na zamrożonej klatce (P4): sam pass pyłu ze znaczników, cała klatka rysunku ze znaczników i ze ściany, włączony i wyłączony. Bez kroków. */
      async kosztPylu(probek = 15, sciana = 48) {
        stan.kroczyc = false;
        stan.rysowac = false;
        await new Promise((ok) => setTimeout(ok, 300));
        await device.queue.onSubmittedWorkDone();
        const backend = renderer.backend;
        const mediana = (l) => { l.sort((a, b) => a - b); return l[l.length >> 1]; };
        const raz = async (wl) => {
          obraz.pyl.wlacz(wl);
          const rys = [];
          for (let k = 0; k < probek; k++) {
            backend.trackTimestamp = true;
            obraz.rysuj(renderer, camera, 0);
            rys.push(await renderer.resolveTimestampsAsync('render'));
            backend.trackTimestamp = false;
            backend.timestampQueryPool?.render?.timestamps?.clear?.();
            await device.queue.onSubmittedWorkDone();
          }
          const t0 = performance.now();
          for (let k = 0; k < sciana; k++) {
            obraz.rysuj(renderer, camera, 0);
            if ((k + 1) % 8 === 0) await device.queue.onSubmittedWorkDone();
          }
          await device.queue.onSubmittedWorkDone();
          return { rysunekGpuMs: mediana(rys), scianaMs: (performance.now() - t0) / sciana };
        };
        const wl1 = await raz(true);
        const wyl = await raz(false);
        const wl2 = await raz(true);
        const samPass = [];
        for (let k = 0; k < probek; k++) {
          backend.trackTimestamp = true;
          obraz.pyl.rysuj(renderer, camera);
          renderer.setRenderTarget(null);
          samPass.push(await renderer.resolveTimestampsAsync('render'));
          backend.trackTimestamp = false;
          backend.timestampQueryPool?.render?.timestamps?.clear?.();
          await device.queue.onSubmittedWorkDone();
        }
        stan.rysowac = true;
        return { wl1, wyl, wl2, samPassMs: mediana(samPass), w: renderer.domElement.width, h: renderer.domElement.height, cel: [obraz.pyl.rt.width, obraz.pyl.rt.height] };
      },
      bezZegara(b = true) { stan.kroczyc = !b; },
    },
  });
}
