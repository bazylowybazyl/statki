// Dźwięki obszarów gry, które były nieme (warp, przyloty, rdzeń reaktora, potem walka, myśliwce, praca w przestrzeni,
// interfejs) — wpisy listy generatora ElevenLabs w osobnym pliku, dołączane jednym importem do
// scripts/dzwieki-elevenlabs.lista.mjs (pola jak tam). Tabela gry tych dźwięków: src/audio/dzwiekiSwiata.js.
//
// Opisy pisane pod oceny użytkownika (reguła `dzwiek`): krótko i wyraźnie, „with instant attack” przy zdarzeniach
// chwilowych, „mid-range, no bass boom” przy spokojnych; bez „massive / huge / cinematic / thunderous”, „thud / boom /
// resonating”, „muffled / subtle”. Samo „mid-range, no bass boom” przy świstach i wyrzutach z warpa nie wystarcza
// (wychodziły w 79–97% basem) — tam „high and mid frequencies only, no low end, no rumble”. `styl` zastępuje wspólny `STYL` listy (ten ma „cinematic”, a pliki z nim — warp,
// przylot, reaktor, mostek — wychodziły w 70–96% energii poniżej 150 Hz).

export const STYL_SWIATA = 'Clean game sound effect, high fidelity, clear mid and high frequencies, no music, no voices.';

const S = STYL_SWIATA;

export const DZWIEKI_SWIATA = [
  // ── Warp gracza (ładowanie 0,8 s, kop, tunel, zejście z warpa) ──────────────────────────────────────────────────
  {
    id: 'warpLadowanie', grupa: 'Warp', nazwa: 'Warp — ładowanie (0,8 s)', s: 1, styl: S,
    opis: 'Napęd skokowy nabiera mocy przez 0,8 s przed kopem.',
    prompt: 'Starship jump drive spooling up for one second with instant attack: quickly rising electric whine over a tightening energy hum, ends abruptly, mid-range, no bass boom',
  },
  {
    id: 'warpKop', grupa: 'Warp', nazwa: 'Warp — skok', s: 1.5, warianty: 4, styl: S,
    opis: 'Wejście w tunel: trzask energii i świst odlotu (gracz i odlot obcych).',
    prompt: 'Starship jumping into warp with instant attack: sharp bright energy snap and a fast tearing whoosh shooting away into the distance, mid-range, no bass boom',
  },
  {
    id: 'warpTunel', grupa: 'Warp', nazwa: 'Warp — lot (pętla)', s: 8, petla: true, styl: S,
    opis: 'W tunelu warpa: szum przepływu energii z migotaniem, bez dudnienia.',
    prompt: 'Steady rushing flow of a warp tunnel around a starship: airy energy stream with soft shimmering high harmonics over a light mid-range hum, no melody, no bass rumble, seamless loop',
  },
  {
    id: 'warpZejscie', grupa: 'Warp', nazwa: 'Warp — zejście z warpa', s: 2, warianty: 4, styl: S,
    opis: 'Wyjście z tunelu: szum, który szybko hamuje, i gasnące wyładowanie.',
    prompt: 'Starship dropping out of warp with instant attack: bright hissing energy rush with a quick falling pitch sweep, ending in a crisp electric crackle, high and mid frequencies only, no low end, no rumble',
  },
  // ── Przylot i odlot obcych okrętów (rejestr warpTraffic) ─────────────────────────────────────────────────────────
  {
    id: 'warpZwiastun', grupa: 'Warp', nazwa: 'Przylot — zwiastun', s: 2.5, styl: S,
    opis: 'Zwiastun przylotu (oś 2–3 s przed wyrzutem) i ładowanie odlotu obcego okrętu.',
    prompt: 'Space distortion building up for two seconds with instant onset: rising shimmering energy swell with faint electric crackle, getting more intense, mid-range, no bass boom',
  },
  {
    id: 'przylotWyrzut', grupa: 'Warp', nazwa: 'Przylot — wyrzut z warpa', s: 1.5, warianty: 4, styl: S,
    opis: 'Okręt wypada z tunelu i hamuje.',
    prompt: 'Starship emerging from warp with instant attack: crisp electric crack followed by a bright descending hiss sweep and crackling sparks, high and mid frequencies only, no low end, no rumble',
  },
  // ── Rdzeń reaktora (stopienie 1,5 / 2,5 / 3,5 s wg klasy, detonacja; śmierć z puli HP — sama detonacja) ──────────
  {
    id: 'reaktorStopienie', grupa: 'Rdzeń reaktora', nazwa: 'Rdzeń — stopienie (pętla)', s: 5, petla: true, warianty: 4, styl: S,
    opis: 'Stopienie rdzenia: łuki, jęk konstrukcji i pulsujący pisk przeciążenia — głośniej z postępem.',
    // Warianty 1–2 z opisem „…strained metal groaning… mid-range, no bass rumble” — wariant 2 wyszedł basem (94% < 150 Hz).
    prompt: 'Overloading reactor about to fail: dense crackling electric arcs, sharp metal creaks and a pulsing high-pitched energy whine, high and mid frequencies only, no low end, no rumble, seamless loop',
  },
  {
    id: 'reaktorWybuch', grupa: 'Rdzeń reaktora', nazwa: 'Rdzeń — detonacja', s: 3, styl: S,
    opis: 'Detonacja rdzenia: trzask, rozdarcie, gasnąca plazma.',
    prompt: 'Starship reactor core detonating with instant attack: blinding sharp electric crack, violent energy blast with tearing metal and crackling plasma fading out, punchy mid-range, no long bass rumble',
  },
  // ── Etap 2: walka i lot ──────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'rakietyOstrzezenie', grupa: 'Walka', nazwa: 'Ostrzeżenie: rakiety w Atlasa (pętla)', s: 3, petla: true, styl: S,
    opis: 'Wroga rakieta albo torpeda z namiarem na gracza — szybkie sygnały, dopóki leci.',
    prompt: 'Incoming missile warning tone of a warship cockpit: rapid repeating high-pitched electronic beeps at a steady fast tempo, urgent but clean, no voice, seamless loop',
  },
  {
    id: 'hcRozruch', grupa: 'Hipercruise', nazwa: 'Hipercruise — rozruch', s: 2.5, styl: S,
    opis: 'Rozruch napędu przelotowego (2–4 s wg klasy): narastający gwizd turbiny i ryk.',
    prompt: 'Starship cruise drive spooling up with instant onset: rising turbine whine and building engine roar over two seconds, high and mid frequencies only, no low end, no rumble',
  },
  {
    id: 'hcKop', grupa: 'Hipercruise', nazwa: 'Hipercruise — wejście', s: 1.5, styl: S,
    opis: 'Koniec rozruchu: zryw silników i szum przyspieszenia.',
    prompt: 'Starship engaging high-speed cruise with instant attack: bright engine surge and a quick rushing whoosh forward, high and mid frequencies only, no low end, no rumble',
  },
  {
    id: 'hcLot', grupa: 'Hipercruise', nazwa: 'Hipercruise — lot (pętla)', s: 6, petla: true, styl: S,
    opis: 'Przelot: równy szum pędu i cichy gwizd napędu.',
    // Pierwszy przebieg („…airy rushing flow with a soft constant engine whine…”) — 77–82% basem; „engine” ciągnie w dół.
    prompt: 'Fast steady airy rushing hiss with a soft constant high whistle, like air streaming past at great speed, no melody, high and mid frequencies only, no low end, no rumble, seamless loop',
  },
  {
    id: 'hcWyjscie', grupa: 'Hipercruise', nazwa: 'Hipercruise — wyjście', s: 1.5, styl: S,
    opis: 'Wyjście z przelotu: zryw się urywa, szum opada.',
    prompt: 'Starship dropping out of high-speed cruise with instant attack: engine surge cutting off and a falling rushing whoosh as it slows down, high and mid frequencies only, no low end, no rumble',
  },
  // ── Etap 3: myśliwce i hangary ────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'mysliwiecWyrzut', grupa: 'Myśliwce', nazwa: 'Myśliwiec — wyrzut z hangaru', s: 1, warianty: 4, styl: S,
    opis: 'Wyrzut z wyrzutni lotniskowca (co 0,26 s z jednej wyrzutni): stuk katapulty, prowadnica, zapłon.',
    prompt: 'Small fighter craft catapulted out of a carrier launch tube with instant attack: sharp pneumatic clank, fast mechanical rail slide and a short bright thruster ignition burst, high and mid frequencies only, no low end',
  },
  {
    id: 'mysliwiecPrzelot', grupa: 'Myśliwce', nazwa: 'Myśliwiec — przelot', s: 1.5, warianty: 4, styl: S,
    opis: 'Myśliwiec mija środek kadru z dużą prędkością: krótki gwizd silnika z opadającym tonem.',
    prompt: 'Small space fighter flying past close at high speed with instant onset: short bright engine whine with a fast doppler pitch drop, high and mid frequencies only, no low end, no rumble',
  },
  {
    id: 'mysliwiecDzialko', grupa: 'Myśliwce', nazwa: 'Myśliwiec — działko', s: 0.5, warianty: 4, styl: S,
    opis: 'Pojedynczy strzał lekkiego działka myśliwca (lżej niż działka okrętów).',
    prompt: 'Single shot of a small fighter light rapid-fire cannon with instant attack: tight snappy pop with a short metallic click, dry, high and mid frequencies only, no bass',
  },
  {
    id: 'bombaZrzut', grupa: 'Myśliwce', nazwa: 'Bomba — zrzut', s: 0.6, styl: S,
    opis: 'Zwolnienie bomby z zaczepu myśliwca.',
    prompt: 'Bomb released from a small space fighter with instant attack: crisp magnetic clamp release clack and a short hiss, dry, high and mid frequencies only, no bass',
  },
  {
    id: 'bombaWybuch', grupa: 'Myśliwce', nazwa: 'Bomba — wybuch na kadłubie', s: 1.5, warianty: 4, styl: S,
    opis: 'Bomba myśliwca wybucha na kadłubie: trzask, rozdarcie blachy, krótki ogień.',
    prompt: 'Fighter bomb detonating against a warship hull with instant attack: sharp explosive crack, tearing metal and a crackling fire burst fading quickly, punchy mid-range, no long bass rumble',
  },
  {
    id: 'mysliwiecLadowanie', grupa: 'Myśliwce', nazwa: 'Myśliwiec — lądowanie w hangarze', s: 1, styl: S,
    opis: 'Powrót do hangaru: chwyt zaczepu i gaśnięcie silnika.',
    prompt: 'Small fighter docking back into a carrier hangar with instant attack: firm magnetic clamp clunk and a short engine spool-down whine, high and mid frequencies only, no low end',
  },
  // ── Etap 4: praca w przestrzeni ───────────────────────────────────────────────────────────────────────────────────
  {
    id: 'kopalniaLaser', grupa: 'Praca w przestrzeni', nazwa: 'Kopalnia — laser dronów (pętla)', s: 4, petla: true, warianty: 2, styl: S,
    opis: 'Drony kopalni tną skałę laserem (LPM w trybie N).',
    prompt: 'Mining laser cutting into rock, seamless loop: steady bright electric buzz with crackling sizzle of vaporizing stone, high and mid frequencies only, no low end, no rumble',
  },
  {
    id: 'kopalniaPila', grupa: 'Praca w przestrzeni', nazwa: 'Kopalnia — piła (pętla)', s: 4, petla: true, warianty: 2, styl: S,
    opis: 'Piła plazmowa kopalni w skale.',
    prompt: 'Industrial plasma saw cutting through solid rock, seamless loop: steady harsh grinding screech with crackling sparks, high and mid frequencies only, no low end, no rumble',
  },
  {
    id: 'skalaWybuch', grupa: 'Praca w przestrzeni', nazwa: 'Skała — wybuch ładunku', s: 1.5, warianty: 4, styl: S,
    opis: 'Ładunek kopalni rozsadza skałę: trzask, gruz.',
    prompt: 'Explosive mining charge blasting a rock asteroid with instant attack: sharp crack, burst of shattering stone and gravel debris scattering, punchy mid-range, no long bass rumble',
  },
  {
    id: 'skalaPekniecie', grupa: 'Praca w przestrzeni', nazwa: 'Skała — pęknięcie i rozpad', s: 1.5, warianty: 4, styl: S,
    opis: 'Skała pęka na odłamy.',
    prompt: 'Large rock splitting apart with instant attack: loud stone crack, grinding fracture and chunks breaking off, mid-range, no bass boom',
  },
  {
    id: 'urobekZbior', grupa: 'Praca w przestrzeni', nazwa: 'Urobek — do ładowni', s: 0.6, styl: S,
    opis: 'Odłam rudy wciągnięty do ładowni.',
    prompt: 'Chunk of ore pulled into a cargo hatch with instant attack: short dry stone clatter and a metal hatch clack, high and mid frequencies only, no bass',
  },
  {
    id: 'wiazkaZbiorki', grupa: 'Praca w przestrzeni', nazwa: 'Wiązka zbiórki (pętla)', s: 4, petla: true, warianty: 4, styl: S,
    opis: 'Wiązka ciągnie kontenery łupu albo skały (ZBIÓRKA, T kopalni).',
    // Warianty 1–2 z „…smooth humming energy field…” — wariant 2 wyszedł basem (89% < 150 Hz); „hum” ciągnie w dół.
    prompt: 'Tractor beam field pulling cargo, seamless loop: smooth airy energy shimmer with soft high warbling tones, high and mid frequencies only, no low end, no hum, no rumble',
  },
  {
    id: 'kontenerZbior', grupa: 'Praca w przestrzeni', nazwa: 'Kontener — w ładowni', s: 0.8, warianty: 5, styl: S,
    opis: 'Kontener zaryglowany w ładowni.',
    // Warianty 1–3 z „…with instant attack: firm metal clunk…” — dwa z atakiem po 0,26–0,37 s.
    prompt: 'Cargo container locking into a ship hold, the sound starts immediately at the very first moment: firm metal clunk of magnetic latches followed by a short hydraulic hiss, mid-range, no bass boom',
  },
  {
    id: 'dronWylot', grupa: 'Praca w przestrzeni', nazwa: 'Dron — wylot', s: 0.6, styl: S,
    opis: 'Dron naprawczy wylatuje z gniazda.',
    prompt: 'Small repair drone launching from a ship with instant attack: quick bright servo whir and a tiny thruster puff, high frequencies only, no bass',
  },
  {
    id: 'dronDok', grupa: 'Praca w przestrzeni', nazwa: 'Dron — powrót do gniazda', s: 0.6, styl: S,
    opis: 'Dron wraca do gniazda.',
    prompt: 'Small drone docking into a ship bay with instant attack: crisp mechanical click and a short servo whir winding down, high frequencies only, no bass',
  },
  {
    id: 'dronSpaw', grupa: 'Praca w przestrzeni', nazwa: 'Dron — spaw (pętla)', s: 4, petla: true, warianty: 2, styl: S,
    opis: 'Drony spawają kadłub.',
    prompt: 'Small robotic welding torch repairing a metal hull, seamless loop: crackling arc welding sizzle with tiny spark pops, high and mid frequencies only, no low end',
  },
  {
    id: 'dronLata', grupa: 'Praca w przestrzeni', nazwa: 'Dron — łata gotowa', s: 0.6, styl: S,
    opis: 'Komórka kadłuba odrosła pod łatą.',
    prompt: 'Hull patch finished by a repair drone with instant attack: short bright metallic tap and a soft rising confirmation chirp, clean, no bass',
  },
  {
    id: 'kapsulaWyrzut', grupa: 'Praca w przestrzeni', nazwa: 'Kapsuła ratunkowa — wyrzut', s: 0.8, warianty: 4, styl: S,
    opis: 'Kapsuła odstrzelona z kadłuba ginącego okrętu.',
    prompt: 'Escape pod ejected from a damaged starship with instant attack: sharp pyrotechnic bolt pop and a short hiss of venting gas, high and mid frequencies only, no bass boom',
  },
  {
    id: 'kapsulaSilnik', grupa: 'Praca w przestrzeni', nazwa: 'Kapsuła ratunkowa — zapłon', s: 1, styl: S,
    opis: 'Kapsuła odpala silnik po dryfie.',
    prompt: 'Small escape pod rocket motor igniting with instant attack: short bright hissing thrust that settles into a steady small jet, high and mid frequencies only, no low end',
  },
];
