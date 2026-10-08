// ============================================================
// Misja 1 „Cicha stocznia” — KWESTIE DIALOGÓW. MIEJSCE NA FABUŁĘ.
//
// Tekst w [nawiasach] to zaślepka opisująca, co ma paść w scenie — do zastąpienia prawdziwym dialogiem.
// Kwestia: { who, text, portrait?, hold? } — `who` z obsady (src/data/story/cast.js), `portrait` nadpisuje
// portret obsady (np. inna mina), `hold` — ile sekund kwestia radia wisi po wypisaniu (domyślnie z długości).
// Sceny 'scene' czekają na gracza (Spacja / Enter / klik, Esc — pomiń), 'radio' lecą same w trakcie gry.
// Liczba kwestii w scenie jest dowolna — skrypt misji odtwarza całą tablicę.
// Misja 2 „Odwet” (odwet piratów, wsparcie, powrót do K-7): mission02.dialogue.js.
// ============================================================

export const MISSION01_TITLE = 'Cicha stocznia';

export const MISSION01_DIALOGUE = Object.freeze({
  // Atlas w hali K-7, po locie kamery. Odprawa: kto, co, gdzie, dlaczego.
  briefing: [
    { who: 'k7', text: '[Kontrola K-7 potwierdza gotowość Atlasa w stanowisku C-01.]' },
    { who: 'admiral', text: '[Odprawa: na obrzeżach układu coś się dzieje — ruch piratów, nic pewnego.]' },
    { who: 'intel', text: '[Wywiad: podejrzewamy ukrytą stocznię, ale nikt jej nie widział. Bez potwierdzenia.]' },
    { who: 'admiral', text: '[Rozkaz: skok w pobliże, rozpoznanie. Jeśli to stocznia — wejść po cichu i zniszczyć, zanim zwodują flotę.]' },
    { who: 'player', text: '[Dowódca przyjmuje rozkaz.]' }
  ],
  // Suwnice puszczają kadłub.
  undock: [
    { who: 'k7', text: '[Kontrola K-7: złączki odłączone, droga do bramy wolna. Powodzenia.]' }
  ],
  // Poza halą — kurs na cel.
  course: [
    { who: 'xo', text: '[Pierwszy oficer: kurs na obrzeża wyznaczony. Wyjdziemy z warpa w bezpiecznej odległości.]' }
  ],
  // Wyjście z warpa na obrzeżach — mgła wojny: czujniki grawitacyjne widzą tylko dużą masę (bez tożsamości).
  massContact: [
    { who: 'xo', text: '[Wyszliśmy z warpa. Czujniki grawitacyjne: duża masa przed nami, kilkadziesiąt kilometrów. Nic więcej nie widać.]' },
    { who: 'xo', text: '[Proponuję zwiad — dron albo ostrożne podejście. Nie dajmy się zobaczyć.]' }
  ],
  // Rozpoznanie: to jest stocznia piratów.
  identified: [
    { who: 'xo', text: '[Mamy obraz! To stocznia piratów — zaparkowany rząd okrętów, eskorta, a w hali coś dużego.]' },
    { who: 'intel', text: '[Wywiad: potwierdzamy. Plan bez zmian — wejść po cichu.]' }
  ],
  // Po rozpoznaniu — podejście w maskowaniu.
  arrival: [
    { who: 'xo', text: '[Nas jeszcze nie widzą. Maskowanie teraz.]' }
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
    { who: 'xo', text: '[Z hali wylatuje eskorta — i supercapital. Bierzemy ich.]' }
  ],
  // Wykrycie przed taranem (maskowanie zdjęte za wcześnie).
  spotted: [
    { who: 'pirate', text: '[Herszt: mamy gościa! Otworzyć ogień!]' }
  ],
  // Zegar wodowania (2026-10-07): załogi biegną do okrętów na parkingu.
  crews: [
    { who: 'xo', text: '[Załogi biegną do okrętów na parkingu — rozgrzewają reaktory. Mamy niecałą minutę, zanim pierwszy wystartuje.]' },
    { who: 'xo', text: '[Co zniszczymy w stanowiskach, nie będzie z nami walczyć.]' }
  ],
  // Pierwszy okręt z parkingu wychodzi przez bramę stanowiska.
  firstLaunch: [
    { who: 'xo', text: '[Pierwszy okręt wychodzi z parkingu — rufą przez bramę stanowiska!]' }
  ],
  // Pochylnie w hali: pancerniki w budowie kończą wodowanie.
  slipWarn: [
    { who: 'intel', text: '[Wywiad: na pochylniach w hali stoją dwa pancerniki — kończą wodowanie. Hexlance przebije dach.]' }
  ],
  slipLaunch: [
    { who: 'xo', text: '[Wodowanie! Pancernik z pochylni wychodzi bramą G-01.]' }
  ],
  // Supercapital poniżej 2/3 punktów: herszt każe startować wszystkim od razu.
  bossRush: [
    { who: 'pirate', text: '[Herszt: wszystko, co ma silniki — w górę! Natychmiast!]' },
    { who: 'xo', text: '[Przyspieszają starty na parkingu!]' }
  ],
  // Supercapital poniżej 1/3: ucieka i ładuje skok.
  bossFlee: [
    { who: 'xo', text: '[Supercapital zawraca — ładuje skok! Jeśli ucieknie, wróci z resztą floty.]' }
  ],
  bossKilled: [
    { who: 'xo', text: '[Supercapital zniszczony! Herszt nie wyszedł z tego żywy.]' }
  ],
  // Mostek zniszczony — okręt bez dowodzenia.
  bossHulk: [
    { who: 'xo', text: '[Mostek supercapitala trafiony — okręt bez dowodzenia, dryfuje.]' }
  ],
  bossEscaped: [
    { who: 'pirate', text: '[Herszt: to jeszcze nie koniec…]' },
    { who: 'xo', text: '[Uciekł. Wróci — i nie sam.]' }
  ],
  // Okręty stoczni rozbite — czas na budynek.
  defencesDown: [
    { who: 'xo', text: '[Okręty piratów rozbite. Teraz suchy dok — bronią wbudowaną.]' }
  ],
  // Stocznia wylatuje w powietrze.
  shipyardDown: [
    { who: 'xo', text: '[Trafienie! Reaktory stoczni idą w łańcuchu!]' },
    { who: 'pirate', text: '[Herszt: zapłacisz za to…]' }
  ],
  // Koniec misji 1 — w polu, nad gruzami (dalej misja 2: naprawa, odwet).
  yardVictory: [
    { who: 'admiral', text: '[Admirał: stocznia zniszczona. Dobra robota — ale zostańcie w rejonie, piraci tego nie zostawią.]' }
  ],
  // Porażka (Atlas zniszczony).
  defeat: [
    { who: 'xo', text: '[Tracimy okręt!]' }
  ]
});
