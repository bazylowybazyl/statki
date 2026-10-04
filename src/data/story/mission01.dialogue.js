// ============================================================
// Misja 1 „Cicha stocznia” — KWESTIE DIALOGÓW. MIEJSCE NA FABUŁĘ.
//
// Tekst w [nawiasach] to zaślepka opisująca, co ma paść w scenie — do zastąpienia prawdziwym dialogiem.
// Kwestia: { who, text, portrait?, hold? } — `who` z obsady (src/data/story/cast.js), `portrait` nadpisuje
// portret obsady (np. inna mina), `hold` — ile sekund kwestia radia wisi po wypisaniu (domyślnie z długości).
// Sceny 'scene' czekają na gracza (Spacja / Enter / klik, Esc — pomiń), 'radio' lecą same w trakcie gry.
// Liczba kwestii w scenie jest dowolna — skrypt misji odtwarza całą tablicę.
// ============================================================

export const MISSION01_TITLE = 'Cicha stocznia';

export const MISSION01_DIALOGUE = Object.freeze({
  // Atlas w hali K-7, po locie kamery. Odprawa: kto, co, gdzie, dlaczego.
  briefing: [
    { who: 'k7', text: '[Kontrola K-7 potwierdza gotowość Atlasa w stanowisku C-01.]' },
    { who: 'admiral', text: '[Odprawa: wywiad namierzył ukrytą stocznię piratów na obrzeżach układu.]' },
    { who: 'intel', text: '[Wywiad: stocznia stoi w cieniu, pełno zaparkowanych kadłubów, słaba obrona — na razie.]' },
    { who: 'admiral', text: '[Rozkaz: wejść po cichu, zniszczyć stocznię, zanim zwodują flotę.]' },
    { who: 'player', text: '[Dowódca przyjmuje rozkaz.]' }
  ],
  // Suwnice puszczają kadłub.
  undock: [
    { who: 'k7', text: '[Kontrola K-7: złączki odłączone, droga do bramy wolna. Powodzenia.]' }
  ],
  // Poza halą — kurs na cel.
  course: [
    { who: 'xo', text: '[Pierwszy oficer: kurs na obrzeża wyznaczony. Czekamy na skok.]' }
  ],
  // Wyjście z warpa w pobliżu stoczni.
  arrival: [
    { who: 'xo', text: '[Jesteśmy na miejscu. Czujniki piratów nas jeszcze nie widzą.]' },
    { who: 'intel', text: '[Wywiad: stocznia przed wami. Maskowanie teraz.]' }
  ],
  // Maskowanie włączone.
  cloaked: [
    { who: 'xo', text: '[Maskowanie aktywne. Pełna cisza radiowa.]' }
  ],
  // Blisko rzędu zaparkowanych okrętów — przed taranem.
  ramOrder: [
    { who: 'player', text: '[Dowódca: pełna naprzód. Taranujemy.]' }
  ],
  // Alarm w stoczni — po taranie (albo po wykryciu).
  alarm: [
    { who: 'pirate', text: '[Herszt: alarm! Kto to jest?! Wszyscy do dział!]' },
    { who: 'xo', text: '[Wieżyczki i eskorta budzą się. Bierzemy ich.]' }
  ],
  // Wykrycie przed taranem (maskowanie zdjęte za wcześnie).
  spotted: [
    { who: 'pirate', text: '[Herszt: mamy gościa! Otworzyć ogień!]' }
  ],
  // Obrona rozbita — czas na budynek.
  defencesDown: [
    { who: 'xo', text: '[Obrona rozbita. Budynek stoczni — bronią wbudowaną.]' }
  ],
  // Stocznia wylatuje w powietrze.
  shipyardDown: [
    { who: 'xo', text: '[Trafienie! Reaktory stoczni idą w łańcuchu!]' },
    { who: 'pirate', text: '[Herszt: zapłacisz za to…]' }
  ],
  // Odwet piratów — floty wychodzą z warpa.
  counterAttack: [
    { who: 'xo', text: '[Liczne sygnatury warpa! Idzie cała flota piratów!]' },
    { who: 'pirate', text: '[Herszt: nikt stąd nie wyleci.]' },
    { who: 'player', text: '[Dowódca: wzywa wsparcie z Ziemi.]' }
  ],
  // Wsparcie z Ziemi.
  support: [
    { who: 'fleet', text: '[Dowódca grupy wsparcia: wychodzimy z warpa, bierzemy flankę.]' }
  ],
  // Piraci się łamią.
  pirateRout: [
    { who: 'pirate', text: '[Herszt: odwrót! Wszyscy odwrót!]' }
  ],
  // Zwycięstwo.
  victory: [
    { who: 'admiral', text: '[Admirał: gratulacje, stocznia zniszczona, flota odparta.]' },
    { who: 'fleet', text: '[Grupa wsparcia wraca na Ziemię.]' }
  ],
  // Powrót do doku — zamknięcie rozdziału.
  homecoming: [
    { who: 'k7', text: '[Kontrola K-7: witamy w domu, Atlas. Stanowisko C-01 wolne.]' },
    { who: 'admiral', text: '[Admirał: zasłużony odpoczynek — ale to dopiero początek.]' }
  ],
  // Porażka (Atlas zniszczony).
  defeat: [
    { who: 'xo', text: '[Tracimy okręt!]' }
  ]
});
