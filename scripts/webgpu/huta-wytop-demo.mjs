// Zrzuty dema „wytop” huty — cykl v2: kupa rudy → docisk i topienie → kula → zrzut grawitacyjny do leja
// (headless Chrome z GPU przez CDP, własny Vite 5458).
//
//   node scripts/webgpu/huta-wytop-demo.mjs [--out .tmp/huta/wytop/cykl2] [--metal 0,1] [--rozmiar 1600x900]
//        [--tylko start,zbieranie,docisk,topienie,dokarmianie,rafinacja,zrzut,pusta,panel]
//        [--plan plik.json] [--kod "wyrażenie JS przed zrzutem"] [--query drganie=0] [--raport nazwa.json] [--prefiks nazwa]
//        [--koszt "gaz=0;gazJakosc=0;gazJakosc=1;gazJakosc=2" [--kosztFaza dokarmianie] [--kosztCzas 6]]
// GAZ (runda 5): `--query gaz=0` — bez pola gazu (A/B), `--query gazJakosc=0|1|2` — preset pola. `--koszt` — pomiar
// kosztu GPU na żywo (pętla strony, krok w czasie rzeczywistym) dla wariantów zapytania PO KOLEI: ms GPU klatki
// i compute, klatki na sekundę, liczba rysunków; bez zrzutów planu.
//
// Domyślnie dla stali (metal 0) — wszystkie fazy obiegu:
//   start        chwila wejścia na stronę (kupa rudy w 2/3 usypana, struga płynie): z góry i z ukosa
//   zbieranie    kupa gotowa (zimna, nieregularna bryła z ziaren): z góry, z ukosa, wlot ziaren
//   docisk       segmenty cewek dosuwają się do kupy: z ukosa i z góry
//   topienie     SERIA 6 klatek z ukosa (żar idzie przez bryłę, jądro rośnie, kupa zapada się w małą kulę) + 3 z góry
//   dokarmianie  reszta wsadu wtapia się w kulę: z góry, z ukosa (3 klatki co 0,1 s), wlot ziaren
//   rafinacja    wyspy żużla spływają na biegun, ssawa ściąga czapę nitką (widok 4), odbieralnik, czysta kula
//   zrzut        odsuw maszynerii; sygnalizacja w obu stanach z góry; lot (kula wydłużona); SERIA 16 klatek co 1/30 s
//                od zetknięcia z lejem (widok 5; trzy chwile także z góry i z bliska); słup odbicia; spływ; lej stygnie
//   pusta        pusta komora następnego obiegu (światło krąży, lej stygnie) i początek kupy (pierwsze ziarna)
// Dla miedzi (metal 1) — cztery kadry kontrolne (kupa, topienie, kula, zrzut).
//   panel        strona z pętlą na żywo (panel, krok w czasie rzeczywistym) — klatki, ms kroku, GPU
// `--plan plik.json` — własna lista kroków zamiast domyślnej (dla metali z `--metal`), kroki jak w `PLAN` niżej:
//   { "seek": ["topienie", 4.5] } · { "sim": 0.1 } · { "view": 2 } (0–9; runda 6: 8 przejęcie i gięcie, 9 walcowanie,
//   0 z boku — całość; runda 8: "D" — dzielenie z ukosa) · { "top": [x, z, zoom] } ·
//   { "cine": [az, el, odległość, x, y, z] } (widok 7 — odciąg gazu i zbiorniki tlenu) · { "shot": "nazwa" } · { "eval": "kod JS" } · { "suck": 2 } (krokuje do
//   stanu ssawy: 1 dojazd, 2 ściąganie, 3 powrót) · { "until": "wyrażenie JS ze `s` = stats()", "max": 30, "krok": 0.05 }
//   { "probe": "nazwa" } — sonda pola gazu (przesłona pionowa w strefach kryteriów K1–K4, masy pola) do raportu ·
//   { "disk": "nazwa", "at": [x, z, y, r] } — jasność tarczy w kadrze z góry (K5: średnia i odchylenie luminancji) ·
//   { "ring": "nazwa", "at": [x, z, y, r0, r1] } — jasność i barwa pierścienia w kadrze z góry w 36 sektorach (K4 jako
//   kontrast widoczny: porównanie raportów pary `--query gaz=0` / bez — `.tmp/huta/wytop/gaz-koncowe/porownaj.mjs`)
// Strona kroczy tylko przez API (`__wytop.simulate`, `seek`, `renderFrames`) — bez czekania na rAF. Raport: raport.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, screenshotPng, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
if (W > 1600 || H > 900) throw new Error('kadr najwyżej 1600 × 900');
const out = resolve(repo, args.out || '.tmp/huta/wytop/cykl2');
mkdirSync(out, { recursive: true });
const metals = String(args.metal === undefined ? '0,1' : args.metal).split(',').map(Number).filter((n) => n >= 0 && n <= 1);
const only = args.tylko ? String(args.tylko).split(',') : null;
const want = (k) => !only || only.includes(k);
const METAL_ID = ['stal', 'miedz'];
const pre = args.prefiks ? `${args.prefiks}-` : '';
const userPlan = args.plan ? JSON.parse(readFileSync(resolve(repo, String(args.plan)), 'utf8')) : null;

/** Kamera widoku 5 z bliska na lej (z boku, nisko) i z góry na sam lej. */
const LEJ_UKOS = [-0.72, 0.9, 560, 0, -360, 0];

/** Domyślny plan dla stali: kroki w kolejności obiegu (strona startuje w zbieraniu, kupa w 2/3). */
function planSteel() {
  const P = [];
  const shots = (name, views) => { for (const v of views) { P.push({ view: v }); P.push({ shot: `${name}-w${v}` }); } };
  if (want('start')) shots('00-start', [1, 2]);
  if (want('zbieranie')) {
    P.push({ seek: ['zbieranie', 11.6] });
    shots('10-kupa-gotowa', [1, 2, 3]);
    P.push({ cine: [-2.3, 0.55, 430, 0, 0, 0] }, { shot: '10-kupa-zblizenie' });
  }
  if (want('docisk')) {
    P.push({ seek: ['docisk', 1.5] });
    shots('20-docisk-w-ruchu', [2]);
    P.push({ seek: ['docisk', 3.1] });
    shots('21-docisk-koniec', [1, 2]);
  }
  if (want('topienie')) {
    // seria topienia kupy: 6 klatek z ukosa, co druga także z góry
    [1.3, 2.9, 4.5, 6.1, 7.6, 9.0].forEach((t, k) => {
      P.push({ seek: ['topienie', t] });
      shots(`3${k}-topienie-${String(t).replace('.', '_')}s`, k % 2 === 1 ? [2, 1] : [2]);
      if (k === 1) P.push({ cine: [-2.3, 0.55, 430, 0, 0, 0] }, { shot: '36-topienie-zblizenie' });
    });
  }
  if (want('dokarmianie')) {
    P.push({ seek: ['dokarmianie', 0.6] });
    shots('40-mala-kula', [1, 2]);
    P.push({ seek: ['dokarmianie', 4.5] });
    shots('41-dokarmianie', [1, 3]);
    P.push({ view: 2 });
    for (let k = 0; k < 3; k++) { if (k) P.push({ sim: 0.1 }); P.push({ shot: `42-dokarmianie-seria-${k}-w2` }); }
  }
  if (want('rafinacja')) {
    P.push({ seek: ['rafinacja', 2.4] });
    shots('50-zuzel-czapa-rosnie', [1, 4]);
    P.push({ suck: 2 }, { sim: 2.5 });
    shots('51-zuzel-ssawa-nitka', [4, 1, 2]);
    P.push({ sim: 3.5 });
    shots('52-zuzel-odbieralnik', [6]);
    P.push({ seek: ['odsuw', 0.02] });
    shots('53-kula-czysta', [1, 2]);
  }
  if (want('zrzut')) {
    P.push({ seek: ['odsuw', 1.4] });
    shots('60-odsuw', [1, 5]);
    // sygnalizacja: tuż przed zatrzymaniem (światło krąży) i tuż po (światło stoi, dno świeci, kula jeszcze wisi)
    P.push({ seek: ['odsuw', 2.5] });
    shots('61-sygnal-0g', [1, 5]);
    P.push({ seek: ['zrzut', 0.3] });
    shots('62-sygnal-grawitacja', [1, 5]);
    // lot: kula wydłużona w osi spadku (dwie klatki), potem SERIA WLEWANIA co 1/30 s od zetknięcia z lejem przez 0,5 s
    // (kula → placek z koroną → jezioro ze słupem odbicia; zetknięcie ok. 1,72 s od zatrzymania świateł)
    P.push({ seek: ['zrzut', 1.1] }, { view: 5 }, { shot: '63-lot-0-w5' }, { sim: 0.3 }, { shot: '63-lot-1-w5' }, { view: 2 }, { shot: '63-lot-1-w2' }, { view: 5 });
    P.push({ until: 's.drop.impactT >= 0', max: 3, krok: 1 / 60 });
    for (let k = 0; k < 16; k++) {
      const id = String(k).padStart(2, '0');
      P.push({ view: 5 }, { shot: `64-wlewanie-${id}-w5` });
      if (k === 3 || k === 6 || k === 10) P.push({ view: 1 }, { shot: `64-wlewanie-${id}-w1` }, { cine: LEJ_UKOS }, { shot: `64-wlewanie-${id}-lej-zblizenie` });
      P.push({ sim: 1 / 30 });
    }
    P.push({ seek: ['zrzut', 2.45] });
    shots('65-korona-slup', [5]);
    P.push({ cine: LEJ_UKOS }, { shot: '65-korona-slup-zblizenie' });
    P.push({ seek: ['zrzut', 4.2] });
    shots('66-splyw', [1, 5]);
    P.push({ seek: ['zrzut', 7.3] });
    shots('67-splyw-koniec', [5]);
    P.push({ cine: LEJ_UKOS }, { shot: '67-splyw-koniec-zblizenie' }, { top: [0, 0, 1.5] }, { shot: '67-splyw-koniec-gora' });
    P.push({ seek: ['zrzut', 9.0] });
    shots('68-lej-stygnie', [5]);
  }
  if (want('pusta')) {
    P.push({ seek: ['pusta', 0.7] });
    shots('70-pusta', [1, 2, 5]);
    P.push({ seek: ['zbieranie', 3.9] });
    shots('71-pierwsze-ziarna', [2, 3]);
    P.push({ seek: ['zbieranie', 6.5] });
    shots('72-kupa-rosnie', [1, 2]);
    P.push({ top: [0, 0, 1.5] }, { shot: '72-kupa-rosnie-gora' });
  }
  return P;
}

/** Miedź: kadry kontrolne. */
function planCopper() {
  return [
    { seek: ['zbieranie', 11.6] }, { view: 2 }, { shot: '10-kupa-gotowa-w2' },
    { seek: ['topienie', 5.5] }, { view: 2 }, { shot: '32-topienie-w2' },
    { seek: ['dokarmianie', 4.5] }, { view: 1 }, { shot: '41-dokarmianie-w1' },
    { seek: ['zrzut', 2.0] }, { view: 5 }, { shot: '63-zrzut-wlanie-w5' }
  ];
}

const { server, base } = await startVite(Number(args.port || 5458));
// takt: true — headless w takcie monitora, bez --disable-frame-rate-limit (praca przy komputerze użytkownika)
const chrome = await startChrome({ width: W, height: H, takt: true });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 240000) => evaluate(cdp, e, t);
const report = { rozmiar: [W, H], metale: {}, zrzuty: {}, sondy: {}, tarcze: {} };

async function open(query) {
  await cdp.send('Page.navigate', { url: `${base}/dema/huta-wytop.html?${query}` });
  const ok = await waitFor(cdp, 'window.__wytop && (window.__wytop.ready || window.__wytop.errors.length > 0)', 240000);
  if (!ok) throw new Error('demo nie wstało');
  const errs = await ev('window.__wytop.errors');
  if (errs.length) throw new Error(`błąd strony: ${errs[0]}`);
}

const r2 = (v) => +(+v).toFixed(2);
async function shot(name, frames = 3) {
  if (args.kod) await ev(String(args.kod));
  await ev(`window.__wytop.renderFrames(${frames})`);
  const file = `${pre}${name}.png`;
  await screenshotPng(cdp, join(out, file));
  const s = await ev('window.__wytop.stats()');
  report.zrzuty[file] = {
    czas: r2(s.time), faza: s.phase, wFazie: r2(s.phaseT), promien: +s.radius.toFixed(1), temperatura: +s.temp.toFixed(3), grzanie: r2(s.heat),
    grawitacja: s.grav, maszyneria: +s.mach.toFixed(0), kupa: { ziaren: s.heap.n, promien: +s.heap.radius.toFixed(0), skala: +s.heap.scale.toFixed(3), zar: r2(s.heap.heat) },
    zrzut: { odZwolnienia: r2(s.drop.fallT), odUderzenia: r2(s.drop.impactT), srodekY: +s.drop.offY.toFixed(0), poziom: +s.drop.level.toFixed(0) },
    tony: Object.fromEntries(Object.entries(s.tons).map(([k, v]) => [k, r2(v)])), bilans: s.balance, niezgodnosc: s.mismatch,
    gaz: s.gaz ? { komoraT: r2(s.gaz.komora), kapielT: r2(s.gaz.kapiel), odciagTs: r2(s.gaz.przeplyw), zbiorniki: s.gaz.napelnienie.map(r2), napelniany: s.gaz.napelniany, oprozniany: r2(s.gaz.oprozniany), okapy: r2(s.gaz.okapy), wentyl: r2(s.gaz.wentyl), tlenOddanyT: r2(s.gaz.oddany), pole: s.gaz.pole ? { preset: s.gaz.pole.preset, kroki: s.gaz.pole.kroki, spi: s.gaz.pole.spi } : null } : null,
    zlozenie: s.zlozenie, liczby: s.counts, ssawa: s.suck,
    linia: s.linia ? { tryb: s.linia.tryb, Q: s.linia.Q, v: s.linia.v, front: s.linia.front, czolo: s.linia.czolo, blonaT: s.linia.tony.blona, bramy: s.linia.bramy, cieploPaneli: s.linia.cieploPaneli,
      // (runda 7, walcowanie) klatki, przęsła z ramionami pętlowników, zgorzelina, brama
      walcownia: s.linia.walcownia ? { klatki: s.linia.walcownia.klatki.map((k) => ({ id: k.id, vWyj: k.vWyj, wsad: k.wsad, szczelina: k.szczelina, chwytow: k.chwytow })), przesla: s.linia.walcownia.przesla, zgorzelina: s.linia.walcownia.zgorzelina, brama: s.linia.walcownia.brama, wyrob: s.linia.walcownia.wyrob } : null,
      // (runda 8) dzielenie: nóż, (runda 9) arkusze w ruchu, kasety, konta, bilans masy i pędu
      odzgorzanie: s.linia.odzgorzanie || null,
      dzielenie: s.linia.dzielenie ? { noz: s.linia.dzielenie.noz, arkusz: s.linia.dzielenie.arkusz, wLocie: s.linia.dzielenie.wLocie, wGrzebieniu: s.linia.dzielenie.wGrzebieniu, doPrzetopu: s.linia.dzielenie.doPrzetopu, kasety: s.linia.dzielenie.kasety, arkusze: s.linia.dzielenie.arkusze, liczniki: s.linia.dzielenie.liczniki, tony: s.linia.dzielenie.tony, bilans: s.linia.dzielenie.bilans, zLinia: s.linia.dzielenie.zLinia, ped: s.linia.dzielenie.ped, przelot: s.linia.dzielenie.przelot } : null } : null, zuzel: { wysp: s.slag.alive, gasnacych: s.slag.dying, drobin: s.slag.specks, czapaT: r2(s.slag.capTons), nitka: s.slag.thread.map(r2), przeplyw: r2(s.slag.flow), granulek: s.slag.granules, czysta: r2(s.slag.clean) }, rysunki: s.calls, trojkaty: s.triangles, syncPoStarcie: s.pipelines.syncAfterReady, pokrycie: s.image ? +s.image.cover.toFixed(3) : 0, bledy: s.errors.length
  };
  console.log(file, `t=${s.time.toFixed(1)}s`, s.phase, `+${s.phaseT.toFixed(2)}`, `R=${s.radius.toFixed(0)}`, `T=${s.temp.toFixed(2)}`, 'kupa', s.heap.n, 'lot', s.counts.flight, 'mach', s.mach.toFixed(0), 'g', s.grav, 'lej', s.tons.lej.toFixed(1), 'rys.', s.calls, 'sync', s.pipelines.syncAfterReady, 'bilans', s.balance);
  return s;
}
const stats = () => ev('window.__wytop.stats()');
const sim = (s) => ev(`window.__wytop.simulate(${s})`);

/** Wykonanie listy kroków planu. */
async function run(plan, id, M) {
  for (const st of plan) {
    if (st.seek) {
      const r = await ev(`window.__wytop.seek(${JSON.stringify(st.seek[0])}, ${st.seek[1] || 0})`);
      if (r.phase !== st.seek[0]) console.warn(`seek ${st.seek[0]}: strona jest w fazie ${r.phase}`);
    } else if (st.sim !== undefined) {
      const r = await sim(st.sim);
      M.kroki.push({ kroki: r.steps, msKroku: +r.stepMs.toFixed(3) });
    } else if (st.view !== undefined) await ev(`window.__wytop.view(${JSON.stringify(st.view)})`);
    else if (st.top) await ev(`window.__wytop.camera(${st.top.join(', ')})`);
    else if (st.cine) await ev(`window.__wytop.cine(${st.cine.join(', ')})`);
    else if (st.eval) await ev(String(st.eval));
    else if (st.suck !== undefined) {
      // krokuje po 1/60 s, aż ssawa wejdzie w stan (1 dojazd, 2 ściąganie, 3 powrót); najwyżej 40 s
      for (let t = 0; t < 40 * 60; t++) { const s = await stats(); if (s.suck === st.suck) break; await sim(1 / 60); }
    } else if (st.until) {
      // krokuje po `krok` s, aż wyrażenie (ze `s` = stats()) będzie prawdziwe; najwyżej `max` s
      const krok = st.krok || 0.05;
      let ok = false;
      for (let t = 0; t < (st.max || 30); t += krok) { if (await ev(`(() => { const s = window.__wytop.stats(); return !!(${st.until}); })()`)) { ok = true; break; } await sim(krok); }
      if (!ok) console.warn(`until: nie doczekano się: ${st.until}`);
    } else if (st.probe) {
      const p = await ev(`window.__wytop.gasProbe(${st.mapa ? 'true' : 'false'})`);
      if (p && p.mapa) {
        // podgląd przesłony z góry w konsoli (znak na 2 × 2 komórki; „ ” < 0,03 … „@” > 0,8)
        const M = p.mapa;
        const ramp = ' .:-=+*#%@';
        const rows = [];
        for (let k = 0; k < M.nz; k += 2) {
          let row = '';
          for (let i = 0; i < M.nx; i += 2) {
            const v = (M.przeslona[k * M.nx + i] + M.przeslona[k * M.nx + i + 1] + M.przeslona[(k + 1) * M.nx + i] + M.przeslona[(k + 1) * M.nx + i + 1]) / 4;
            row += ramp[Math.min(ramp.length - 1, Math.floor(v / 0.8 * (ramp.length - 1) + 0.7))];
          }
          rows.push(row);
        }
        console.log(rows.join('\n'));
        delete p.mapa;
      }
      report.sondy[`${pre}${id}-${st.probe}`] = p;
      if (p) {
        const f = (z) => `${z.srednia.toFixed(3)}/${z.p95.toFixed(3)}`;
        console.log(`sonda ${st.probe}: ${p.jadro ? `jądro ${f(p.jadro)} ` : ''}kula ${f(p.kula)} wyświetlacz ${f(p.wyswietlacz)} lej ${f(p.lej)} pierścień ${f(p.pierscien)} okapy ${f(p.okapy)} (średnia/p95) · pole ${p.masa.razem.toFixed(2)} t (dym ${p.masa.dym.toFixed(2)}) · symulacja ${p.symulacja.komoraT.toFixed(2)} t`);
      }
    } else if (st.ring) {
      const a = st.at || [0, 0, 0, 300, 440];
      const d = await ev(`window.__wytop.ringStats(${a.join(', ')})`);
      report.pierscienie = report.pierscienie || {};
      report.pierscienie[`${pre}${id}-${st.ring}`] = d;
      if (d) console.log(`pierścień ${st.ring}: średnia ${(d.sektory.reduce((s, v) => s + v[0], 0) / d.sektory.length).toFixed(4)}`);
    } else if (st.disk) {
      const a = st.at || [0, 0, 0, 200];
      const d = await ev(`window.__wytop.diskStats(${a.join(', ')})`);
      report.tarcze[`${pre}${id}-${st.disk}`] = d;
      if (d) console.log(`tarcza ${st.disk}: średnia ${d.srednia.toFixed(4)} odchylenie ${d.odchylenie.toFixed(4)} (${d.n} px)`);
    } else if (st.shot) await shot(`${id}-${st.shot}`, st.frames || 3);
  }
}

try {
  if (args.koszt) {
    // KOSZT GPU na żywo: warianty zapytania po kolei (nie naraz), ta sama faza i kamera; próbki zegara GPU Core3D
    const faza = String(args.kosztFaza || 'dokarmianie');
    const czas = Number(args.kosztCzas || 6);
    const widok = args.kosztWidok === undefined ? 1 : /^[0-9]+$/.test(String(args.kosztWidok)) ? Number(args.kosztWidok) : String(args.kosztWidok);
    report.koszt = {};
    for (const q of String(args.koszt).split(';')) {
      await open(`metal=${metals[0] ?? 0}&view=${widok}${q ? `&${q}` : ''}${args.query ? `&${args.query}` : ''}`);
      if (args.kosztKamera) await ev(String(args.kosztKamera));
      await ev(`window.__wytop.seek(${JSON.stringify(faza)}, ${Number(args.kosztT || 3)})`);
      await ev('window.__wytop.resume()');
      await sleep(1500);
      const pr = [];
      for (let k = 0; k < Math.max(2, Math.round(czas)); k++) {
        await sleep(1000);
        const s = await stats();
        pr.push({ gpu: s.gpuMs, compute: s.gpuComputeMs, fps: s.fps, rys: s.calls, krok: s.sim.stepMs, faza: s.phase });
      }
      const avg = (k) => +(pr.reduce((a, b) => a + b[k], 0) / pr.length).toFixed(3);
      const s = await stats();
      report.koszt[q || 'domyślnie'] = { gpuMs: avg('gpu'), gpuComputeMs: avg('compute'), klatki: Math.round(avg('fps')), rysunki: Math.round(avg('rys')), msKroku: avg('krok'), faza: pr[pr.length - 1].faza, pole: s.gaz.pole, syncPoStarcie: s.pipelines.syncAfterReady, bledy: s.errors.length };
      console.log('koszt', q || 'domyślnie', JSON.stringify(report.koszt[q || 'domyślnie']));
    }
  } else
  for (const metal of metals) {
    const id = METAL_ID[metal];
    await open(`shot=1&metal=${metal}${args.query ? `&${args.query}` : ''}`);
    const M = report.metale[id] = { kroki: [] };
    await run(userPlan || (metal === 0 ? planSteel() : planCopper()), id, M);
    const s = await stats();
    M.koniec = { czas: +s.time.toFixed(1), obieg: +s.cycleTime.toFixed(1), bilans: s.balance, niezgodnosc: s.mismatch, tony: s.tons, pipeline: s.pipelines, obraz: s.image, msKroku: +s.sim.stepMs.toFixed(3), msKrokuSzczyt: +s.sim.stepMax.toFixed(2), krokow: s.sim.steps };
  }

  if (want('panel') && !userPlan && !args.koszt) {
    // Jak u użytkownika: pętla rAF, krok w czasie rzeczywistym, panel. Krótko: ok. 10 s.
    await open(`metal=${metals[0] ?? 0}`);
    await sleep(3500);
    await screenshotPng(cdp, join(out, `${pre}panel-widok1.png`));
    const a = await stats();
    await ev('window.__wytop.view(2)');
    await sleep(2500);
    await screenshotPng(cdp, join(out, `${pre}panel-widok2.png`));
    const b = await stats();
    await ev('window.__wytop.view(5)');
    await sleep(2500);
    await screenshotPng(cdp, join(out, `${pre}panel-widok5.png`));
    const c = await stats();
    const pick = (q) => ({
      czas: +q.time.toFixed(1), faza: q.phase, rysunki: q.calls, trojkaty: q.triangles, msKroku: +q.sim.stepMs.toFixed(3), msKrokuSzczyt: +q.sim.stepMax.toFixed(2),
      gpuMs: +(+q.gpuMs).toFixed(2), klatki: Math.round(q.fps), syncPrzyStarcie: q.pipelines.syncList, syncPoStarcie: q.pipelines.syncAfterReady, syncPoStarcieLista: q.pipelines.syncAfterReadyList,
      wLocie: q.counts.flight, kupa: q.counts.heap, bilans: q.balance, naZywo: q.live
    });
    report.naZywo = { widok1: pick(a), widok2: pick(b), widok5: pick(c), bledyStrony: await ev('window.__wytop.errors') };
    console.log('na żywo:', JSON.stringify(report.naZywo));
  }
  report.bledy = logs.errors();
  report.logi = logs.all().filter((l) => !l.startsWith('[log:')).slice(-30);
  console.log('błędy strony:', report.bledy.length, report.bledy.slice(0, 8).join('\n'));
} catch (err) {
  report.wyjatek = String(err && err.stack ? err.stack : err);
  report.bledy = logs.errors();
  console.error(report.wyjatek);
  console.error(report.bledy.slice(0, 12).join('\n'));
} finally {
  writeFileSync(join(out, args.raport || 'raport.json'), JSON.stringify(report, null, 2) + '\n');
  await chrome.close();
  await server.close();
}
process.exit(report.bledy?.length || report.wyjatek ? 1 : 0);
