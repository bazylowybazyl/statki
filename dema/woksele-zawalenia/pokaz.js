// Strona na żywo dema wiązanych wokseli: pętla rAF, kamera orbitalna, panel (docs/SPEC-woksele-zawalenia.md § 5.2–5.4). Efekt od razu po wejściu, bez nakładek w kadrze.
// Zegar stały 1/60 s na krok, najwyżej 2 kroki na klatkę, po przekroczeniu progu 1 krok, reszta przepada: spowolnienie zamiast spirali. Numer kroku z licznika całkowitego.
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createWokseleObraz } from './obraz.js';

const H = 1 / 60;
const PROG_DRUGIEGO_KROKU_MS = 14;
const DROGA_MIGAWEK = '/.tmp/woksele-demo/migawki/';

// Kamery startowe jak w filmie (bieg-film.sh, § 4.7): az, el, cel, odl. Cień: środek i zakres z rys4.mjs.
const K_WIEZA = { az: 32, el: 8, cel: [0, 0, 620], odl: 3300 };
const SCENY = {
  S1: { nazwa: 'S1 podcięcie', kamera: K_WIEZA, cien: [[0, 0, 500], 1700] },
  S2: { nazwa: 'S2 własny ciężar', kamera: K_WIEZA, cien: [[0, 0, 500], 1700] },
  S3: { nazwa: 'S3 przebicie dysku', kamera: { az: 35, el: 22, cel: [0, 0, -250], odl: 3400 }, cien: [[0, 0, -300], 2300] },
  S4: { nazwa: 'S4 próżnia', kamera: { az: 32, el: 8, cel: [0, 0, 650], odl: 6200 }, cien: [[0, 0, 650], 3500] },
  S4grunt: { nazwa: 'S4 przy g = 400', kamera: K_WIEZA, cien: [[0, 0, 650], 3500] },
  krater: { nazwa: 'Krater', kamera: K_WIEZA, cien: [[0, 0, 500], 1700] },
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

export async function startPokaz({ renderer, solver, wypiekSceny, wok, device, adres }) {
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

  const obraz = createWokseleObraz({ solver, camera });
  const sterowanie = new OrbitControls(camera, kanwa);
  sterowanie.enableDamping = true;
  sterowanie.dampingFactor = 0.12;
  sterowanie.maxDistance = 30000;
  sterowanie.minDistance = 60;
  sterowanie.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  sterowanie.zoomToCursor = true;

  const stan = { scena: null, krok: 0, pauza: false, tempo: 1, akum: 0, kroczyc: true, msKlatki: 0, ostatnia: 0, licznik: false, pierwszyKrok: false };

  function krokSceny() {
    solver.krok(renderer);
    if (stan.pierwszyKrok) { obraz.krokBezLimitu(renderer); stan.pierwszyKrok = false; } else obraz.krok(renderer);
    stan.krok++;
  }

  /** Scena przez reset: wgranie buforów, bez nowych pipeline'ów. Kamera tylko przy zmianie sceny, R zostawia ją tam, gdzie jest. */
  function ustawScene(id, { kamera = true } = {}) {
    const opis = SCENY[id];
    if (!opis) throw new Error(`Nieznana scena ${id}`);
    const w = wypiekSceny(id);
    solver.wczytaj(w);
    obraz.wczytaj(w);
    obraz.ustawCien(opis.cien[0], opis.cien[1]);
    stan.scena = id;
    stan.krok = 0;
    stan.akum = 0;
    if (kamera) ustawKamere(camera, sterowanie, opis.kamera);
    zaznacz();
    return w;
  }

  /** Migawka Node (S1_t3.50), dopóki pakiet P2 nie ma zdarzeń: stan z chwili t, dalej swobodny bieg. */
  async function wgrajMigawke(nazwa) {
    const { rozpakujMigawke } = await import('./wzorzec-cpu.js');
    const [rj, rb] = await Promise.all([fetch(`${DROGA_MIGAWEK}${nazwa}.json`), fetch(`${DROGA_MIGAWEK}${nazwa}.bin`)]);
    if (!rj.ok || !rb.ok) throw new Error(`Brak migawki ${nazwa}`);
    const m = rozpakujMigawke(await rj.json(), await rb.arrayBuffer());
    ustawScene(nazwa.split('_')[0]);
    solver.wgraj({ ...m.przed, skG: m.skG, sFr: m.sFr, kotwiceWiezy: m.kotwiceWiezy, budowa: m.budowa });
    obraz.krokBezLimitu(renderer);
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
    const b = dodaj(gr1, SCENY[id].nazwa, () => { ustawScene(id); }, `s:${id}`);
    b.disabled = !(id === 'S1' || id === 'S2' || id === 'S3' || id === 'S4' || id === 'S4grunt') || !zdarzeniaDostepne(id);
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
  /** Sceny ze zdarzeniami czekają na pakiet P2: S3 nie ma zdarzeń, reszta potrzebuje kCzas. */
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
  const start = adres.get('scena') || (solver.kernele.kCzas ? 'S1' : 'S3');
  ustawScene(mig ? mig.split('_')[0] : start);
  zmienRozmiar();
  await obraz.rozgrzej(renderer);
  if (mig) await wgrajMigawke(mig);

  let srednia = 0, klatek = 0, tLicznika = 0;
  function petla(teraz) {
    requestAnimationFrame(petla);
    const dtMs = stan.ostatnia ? teraz - stan.ostatnia : 16.7;
    stan.ostatnia = teraz;
    if (!stan.pauza && stan.kroczyc) {
      stan.akum += Math.min(dtMs, 100) * 0.001 * stan.tempo;
      const maksKrokow = stan.msKlatki > PROG_DRUGIEGO_KROKU_MS ? 1 : 2;
      let k = 0;
      while (stan.akum >= H && k < maksKrokow) { krokSceny(); stan.akum -= H; k++; }
      if (stan.akum >= H) stan.akum = H * 0.999; // reszta przepada
    }
    sterowanie.update();
    obraz.rysuj(renderer, camera, stan.akum);
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

  Object.assign(wok, {
    obraz,
    camera,
    pokaz: {
      stan,
      ustawScene,
      wgrajMigawke,
      /** Harness: scena stoi w chwili t. Kroki bez czekania na rAF, kolejka GPU trzymana krótko. */
      async doChwili(t) {
        stan.kroczyc = false;
        const cel = Math.round(t * 60);
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
      bezZegara(b = true) { stan.kroczyc = !b; },
    },
  });
}
