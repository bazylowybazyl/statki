// Dźwięki obszarów gry, które były nieme: warp gracza, przyloty i odloty obcych okrętów, maskowanie, rdzeń reaktora,
// tło mostka, klik interfejsu (etap 1); ostrzeżenie o rakietach, hipercruise, silniki obcych okrętów (etap 2); myśliwce i hangary (etap 3).
// Czyste dane (bez Web Audio i DOM): wpisy dołączane do tabeli warstwy `DZWIEKI` jednym rozwinięciem w src/audio/dzwiekiLogika.js, zdarzenia — do `ZDARZENIA`.
// Pola wpisu jak w `DZWIEKI` (kategoria, limit, odstęp, zwłoka, wariacja, pętla, `ui`, `poziom`) oraz:
//   `obszar`   — grupa w panelu sceny `?scena=dzwieki` (odsłuch obszarami, nie kategoriami),
//   `warianty` — numery plików z manifestu, które warstwa wczytuje (reszta zostaje w manifeście; wykluczone są pliki
//                z pomiaru „sam bas” albo z atakiem po czasie — tabela pomiarów w docs/DZWIEKI-obszary-2026-11-11.md).
// Reżyser zdarzeń tych dźwięków (czysty, po stronie gry): src/game/dzwiekiObszarow.js.

export const DZWIEKI_SWIATA = Object.freeze({
  // ── Warp gracza: ładowanie 0,8 s (`warp.chargeTime`), skok, tunel (pętla w `warp.state === 'active'`), zejście ──
  warpLadowanie: { kat: 'trafienie', obszar: 'Warp', limit: 1, odstep: 300, zwloka: 0, ton: 0.02, glos: 0.05 },
  warpKop: { kat: 'dzialo', obszar: 'Warp', limit: 3, odstep: 120, zwloka: 2, ton: 0.04, glos: 0.08, warianty: [1, 2, 4] },
  warpTunel: { kat: 'drobne', obszar: 'Warp', petla: true, limit: 1 },
  warpZejscie: { kat: 'dzialo', obszar: 'Warp', limit: 2, odstep: 200, zwloka: 1, ton: 0.03, glos: 0.08, warianty: [1, 4] },
  // ── Obce okręty z warpa (rejestr warpTraffic): zwiastun osi przylotu / ładowanie odlotu, wyrzut; odlot = `warpKop` ──
  warpZwiastun: { kat: 'trafienie', obszar: 'Warp', limit: 3, odstep: 150, zwloka: 2, ton: 0.05, glos: 0.1 },
  przylotWyrzut: { kat: 'dzialo', obszar: 'Warp', limit: 3, odstep: 120, zwloka: 2, ton: 0.05, glos: 0.1 },
  // ── Maskowanie (pliki z pierwszej listy; użytkownik ich jeszcze nie ocenił) ──
  // maskaWl_2 zaczyna się po 0,67 s ciszy, maskaWyl_3 i maskaZerwanie_3 mają atak po 0,3–1,1 s — poza warstwą.
  maskaWl: { kat: 'trafienie', obszar: 'Maskowanie', limit: 2, odstep: 300, zwloka: 0, ton: 0.02, glos: 0.05, warianty: [1, 3] },
  maskaWyl: { kat: 'trafienie', obszar: 'Maskowanie', limit: 2, odstep: 300, zwloka: 0, ton: 0.02, glos: 0.05, warianty: [1, 2] },
  maskaZerwanie: { kat: 'trafienie', obszar: 'Maskowanie', limit: 2, odstep: 300, zwloka: 0, ton: 0.03, glos: 0.08, warianty: [1, 2] },
  // ── Rdzeń reaktora: pętla w stopieniu (1,5 / 2,5 / 3,5 s wg klasy, głośniej z postępem), detonacja ──
  // Plik `reaktor` (7 s: 3 s narastania + wybuch) zostaje poza warstwą: stopienie trwa w grze 1,5–3,5 s, a śmierć z
  // puli HP detonuje bez zapowiedzi — stąd podział na pętlę stopienia i samą detonację.
  reaktorStopienie: { kat: 'dzialo', obszar: 'Rdzeń reaktora', petla: true, limit: 3, warianty: [1, 3, 4] },
  reaktorWybuch: { kat: 'superbron', obszar: 'Rdzeń reaktora', limit: 3, odstep: 150, zwloka: 2, ton: 0.04, glos: 0.08 },
  // ── Tło i interfejs (użytkownik: „tło mostka i klik ok”) ──
  mostek: { kat: 'tlo', obszar: 'Okręt gracza', petla: true, limit: 1, ui: true },
  klik: { kat: 'interfejs', obszar: 'Interfejs', limit: 3, odstep: 40, zwloka: 1, ton: 0.03, glos: 0, ui: true },
  // ── Etap 2: walka i lot ──
  // Wroga rakieta / torpeda z celem = gracz (bufor zagrożeń obrony punktowej) — pętla, dopóki leci.
  rakietyOstrzezenie: { kat: 'interfejs', obszar: 'Walka', petla: true, limit: 1, ui: true },
  // Hipercruise gracza (`hypercruise.state`): spool (2–4 s wg klasy, min. 1 s) → active → drop / idle.
  hcRozruch: { kat: 'trafienie', obszar: 'Hipercruise', limit: 1, odstep: 300, zwloka: 0, ton: 0.02, glos: 0.05 },
  hcKop: { kat: 'dzialo', obszar: 'Hipercruise', limit: 1, odstep: 300, zwloka: 0, ton: 0.03, glos: 0.08, warianty: [2, 3] },
  hcLot: { kat: 'drobne', obszar: 'Hipercruise', petla: true, limit: 1 },
  hcWyjscie: { kat: 'trafienie', obszar: 'Hipercruise', limit: 1, odstep: 300, zwloka: 0, ton: 0.03, glos: 0.08 },
  // ── Etap 3: myśliwce i hangary (gracza i lotniskowców NPC) ──
  // Wyrzut: `ejectFighterFromTube` (co 0,26 s z jednej wyrzutni — odstęp 120 ms daje serię, nie zlewa się).
  mysliwiecWyrzut: { kat: 'drobne', obszar: 'Myśliwce', limit: 4, odstep: 120, zwloka: 2, ton: 0.06, glos: 0.12 },
  // Przelot: najbliższe podejście myśliwca do środka kadru (reżyser), najwyżej raz na 2,5 s na myśliwca.
  mysliwiecPrzelot: { kat: 'drobne', obszar: 'Myśliwce', limit: 3, odstep: 150, zwloka: 1, ton: 0.08, glos: 0.12 },
  // Działko myśliwca (strzelec `fighter` / `interceptor` na szynie strzałów) — lżej niż działka okrętów.
  mysliwiecDzialko: { kat: 'drobne', obszar: 'Myśliwce', limit: 6, odstep: 30, zwloka: 2, ton: 0.07, glos: 0.15, warianty: [1, 2] },
  bombaZrzut: { kat: 'drobne', obszar: 'Myśliwce', limit: 3, odstep: 80, zwloka: 1, ton: 0.05, glos: 0.1 },
  bombaWybuch: { kat: 'dzialo', obszar: 'Myśliwce', limit: 4, odstep: 60, zwloka: 2, ton: 0.06, glos: 0.12, warianty: [1, 3] },
  mysliwiecLadowanie: { kat: 'drobne', obszar: 'Myśliwce', limit: 3, odstep: 120, zwloka: 2, ton: 0.05, glos: 0.1, warianty: [1, 2] }
});

/**
 * Dźwięki z syntezy obszarów (dołączane do `DZWIEKI_SYNTEZY`): silniki obcych okrętów w pobliżu kadru — przepis
 * silnika MAIN gracza, do 3 głosów (src/audio/silnikiObcych.js), 6 dB pod silnikiem gracza.
 */
export const SYNTEZA_SWIATA = Object.freeze({
  silnikObcy: { kat: 'drobne', obszar: 'Silniki obcych', nazwa: 'Silniki obcych okrętów (synteza)', poziom: -12 }
});

/** Zdarzenie gry → id dźwięku (dołączane do `ZDARZENIA`). Pętle (tunel warpa, stopienie, mostek) idą przez `petla`. */
export const ZDARZENIA_SWIATA = Object.freeze({
  warpLadowanie: 'warpLadowanie',
  warpSkok: 'warpKop',
  warpZejscie: 'warpZejscie',
  przylotZwiastun: 'warpZwiastun',
  przylotWyrzut: 'przylotWyrzut',
  odlotLadowanie: 'warpZwiastun',
  odlotSkok: 'warpKop',
  maskowanieWl: 'maskaWl',
  maskowanieWyl: 'maskaWyl',
  maskowanieZerwane: 'maskaZerwanie',
  rdzenDetonacja: 'reaktorWybuch',
  hipercruiseRozruch: 'hcRozruch',
  hipercruiseWejscie: 'hcKop',
  hipercruiseWyjscie: 'hcWyjscie',
  mysliwiecWyrzut: 'mysliwiecWyrzut',
  mysliwiecPrzelot: 'mysliwiecPrzelot',
  mysliwiecStrzal: 'mysliwiecDzialko',
  bombaZrzut: 'bombaZrzut',
  bombaWybuch: 'bombaWybuch',
  mysliwiecLadowanie: 'mysliwiecLadowanie',
  klik: 'klik'
});
