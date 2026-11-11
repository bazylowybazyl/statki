// Lista roboczych dźwięków gry do wygenerowania w ElevenLabs (efekty dźwiękowe z opisu).
// Skrypt: scripts/dzwieki-elevenlabs.mjs, odsłuch: dema/dzwieki-ai.html.
//
// Pola: `id` — nazwa pliku (jak w dema/dzwieki/), `grupa`, `nazwa` i `opis` — po polsku, do odsłuchu,
// `s` — długość w sekundach (API: 0,5–30), `petla` — dźwięk ciągły zapętlany bez szwu,
// `warianty` — ile wersji do wyboru (bez pola: skrypt bierze 3, a dla dźwięków od 5 s — 2),
// `prompt` — opis po angielsku (generator rozumie go najlepiej); skrypt dokleja do niego `STYL`.
//
// Z syntezy (dema/dzwieki) zostają dwa dźwięki ocenione dobrze: silnik MAIN i seria Vulcan / CIWS —
// dlatego nie ma ich na liście. Scena „Bitwa” to składanka innych dźwięków, też jej tu nie ma.

export const STYL = 'Modern cinematic game sound design, high fidelity, no music, no voices.';

export const DZWIEKI = [
  // ── Działa ──────────────────────────────────────────────────────────────────────────────
  {
    id: 'dzialo', grupa: 'Działa', nazwa: 'Działo', s: 2,
    opis: 'Trzask wylotu, huk, dudnienie i zamek.',
    prompt: 'Heavy naval cannon shot on a huge sci-fi battleship: sharp muzzle crack, deep booming thump with sub-bass, short mechanical breech clank at the end, close and dry',
  },
  {
    id: 'railgun', grupa: 'Działa', nazwa: 'Działo szynowe', s: 2.5,
    opis: 'Pisk kondensatora, trzask wyładowania, kopnięcie i dzwonienie szyn.',
    prompt: 'Sci-fi railgun firing: very short rising capacitor whine, violent electric crack, heavy kinetic punch, metallic ringing of the rails fading out',
  },
  {
    id: 'laserPD', grupa: 'Działa', nazwa: 'Laser PD', s: 0.6,
    opis: 'Obrona punktowa: jeden krótki impuls.',
    prompt: 'Single short point-defense laser pulse: tight bright energy zap with a snappy electric transient, dry, not retro, not 8-bit',
  },
  {
    id: 'wiazka', grupa: 'Działa', nazwa: 'Wiązka ciągła', s: 4, petla: true,
    opis: 'Buczenie wiązki z iskrzeniem — pętla.',
    prompt: 'Continuous heavy energy beam weapon sustaining: thick electric hum with crackling arcs and a searing sizzle, steady intensity, seamless loop',
  },
  {
    id: 'flak', grupa: 'Działa', nazwa: 'Flak', s: 2,
    opis: 'Strzał i rozerwania pocisków w oddali.',
    prompt: 'Flak cannon shot: punchy mid-heavy gun thump followed by two or three distant muffled airburst explosions',
  },
  // Bronie Atlasa pod scenę testową dźwięków: atak od pierwszej próbki (bez ładowania) — strzał ma
  // trafiać w chwilę wystrzału, a kilka wież naraz ma się sumować w salwę.
  {
    id: 'tempestIon', grupa: 'Działa', nazwa: 'Tempest Ion', s: 1,
    opis: 'Strzał wieży Tempest Ion: trzask wyładowania i krótkie kopnięcie.',
    prompt: 'Ion railgun turret shot with instant attack and no charge-up: sharp electric crack, ionized plasma snap, short tight bass punch and a quick sizzling tail',
  },
  {
    id: 'yamato', grupa: 'Działa', nazwa: 'Yamato — jedna lufa', s: 2.5,
    opis: 'Lufa baterii głównej: grzmot, ryk plazmy, długi ogon.',
    prompt: 'Single barrel of a massive capital-ship plasma main battery firing with instant attack: huge thunderous boom, searing plasma roar, deep sub-bass and a rolling tail',
  },
  {
    id: 'autocannon', grupa: 'Działa', nazwa: 'Działko automatyczne', s: 0.6,
    opis: 'Pojedynczy strzał działka (okręty pirackie).',
    prompt: 'Single shot of a medium ship autocannon with instant attack: tight punchy crack and a short mechanical action, dry',
  },

  // ── Superbronie ─────────────────────────────────────────────────────────────────────────
  {
    id: 'hexlance', grupa: 'Superbronie', nazwa: 'Hexlance', s: 5,
    opis: 'Ładowanie z iskrzeniem, zassanie i wyładowanie.',
    prompt: 'Superweapon charging and firing: electric charge building with crackling sparks for three seconds, short suction of energy, then a massive piercing lance discharge with a deep bass impact',
  },
  {
    id: 'mjolnir', grupa: 'Superbronie', nazwa: 'Mjolnir', s: 6,
    opis: 'Ładowanie z przyspieszającym pulsem, cisza i strzał.',
    prompt: 'Giant sci-fi siege weapon: low power hum rising with accelerating pulses for four seconds, half a second of near silence, then an enormous thunderous blast with a sub-bass shockwave and electric crackle',
  },

  // ── Rakiety ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'rakieta', grupa: 'Rakiety', nazwa: 'Rakieta', s: 2.5,
    opis: 'Zimny wyrzut z komory, zapłon i odlot.',
    prompt: 'Missile launch from a warship tube: pneumatic cold-launch thump, rocket motor ignition roar, fast whoosh flying away',
  },
  {
    id: 'salwa', grupa: 'Rakiety', nazwa: 'Salwa', s: 3.5,
    opis: 'Kolejne komory jedna po drugiej.',
    prompt: 'Rapid salvo of eight missiles launching one after another from vertical launch cells: sequential thumps and overlapping rocket ignition whooshes flying away',
  },
  {
    id: 'wybuchRakiety', grupa: 'Rakiety', nazwa: 'Trafienie rakiety', s: 1.8,
    opis: 'Głowica rakiety na kadłubie.',
    prompt: 'Missile warhead exploding on a metal hull with instant attack: hard crack, mid-size boom, short burst of fire and debris',
  },
  {
    id: 'supernovaStart', grupa: 'Rakiety', nazwa: 'Supernova — start głowicy', s: 3,
    opis: 'Ciężka torpeda: szczęk, niski zapłon, powolny odlot.',
    prompt: 'Heavy capital-ship torpedo launch with instant attack: deep hydraulic clunk, massive low rocket ignition with a rumbling roar, slow heavy whoosh away',
  },
  {
    id: 'supernovaWybuch', grupa: 'Rakiety', nazwa: 'Supernova — detonacja', s: 5,
    opis: 'Detonacja głowicy Supernova.',
    prompt: 'Enormous warhead detonation in a space battle with instant attack: blinding sharp crack, colossal bass boom, expanding shockwave rumble with crackling energy, long tail',
  },

  // ── Wybuchy ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'wybuch', grupa: 'Wybuchy', nazwa: 'Wybuch', s: 3,
    opis: 'Trzask, huk, ogień i odłamki o kadłub.',
    prompt: 'Large explosion of a spaceship section: sharp crack, deep boom with sub-bass, roaring fire burst, metal debris clattering against a hull',
  },
  {
    id: 'reaktor', grupa: 'Wybuchy', nazwa: 'Wybuch reaktora', s: 7,
    opis: 'Jęk konstrukcji i łuki, zassanie, detonacja.',
    prompt: 'Starship reactor meltdown and detonation: groaning metal structure and electric arcs building for three seconds, sudden implosion suction, then a colossal explosion with a long deep rumbling tail',
  },
  {
    id: 'wybuchMaly', grupa: 'Wybuchy', nazwa: 'Mały wybuch', s: 1,
    opis: 'Zestrzelona rakieta, drobny odłamek.',
    prompt: 'Small mid-air explosion of an intercepted missile with instant attack: quick sharp pop with a short crackle, dry',
  },
  {
    id: 'wybuchOkretu', grupa: 'Wybuchy', nazwa: 'Zniszczenie okrętu', s: 5,
    opis: 'Wybuch, wtórne eksplozje, rozpad kadłuba.',
    prompt: 'Destruction of a medium warship with instant attack: massive explosion, then two secondary blasts as the hull breaks apart, tearing metal and a long deep rumble',
  },

  // ── Kadłub i tarcza ─────────────────────────────────────────────────────────────────────
  {
    id: 'kadlub', grupa: 'Kadłub i tarcza', nazwa: 'Trafienie w kadłub', s: 1.5,
    opis: 'Głuche uderzenie, drgania płyty pancerza, rwanie blachy.',
    prompt: 'Heavy shell impact on thick steel warship armor heard from inside the ship: dull massive thud, resonating armor plate, short metal tearing',
  },
  {
    id: 'rykoszet', grupa: 'Kadłub i tarcza', nazwa: 'Rykoszet', s: 1,
    opis: 'Brzęk i świst odbitego pocisku.',
    prompt: 'Projectile ricochet off thick metal armor: bright metallic clang followed by a fast whining whizz flying away',
  },
  {
    // Decyzja użytkownika 2026-11-11: „tarcza musi być łagodniejsza i szybsza”, wzorzec charakteru — trafienie
    // w tarczę w Starsectorze (miękkie, stłumione, krótkie; bez dzwonienia i szklistego ogona).
    id: 'tarcza', grupa: 'Kadłub i tarcza', nazwa: 'Trafienie w tarczę', s: 0.5,
    opis: 'Miękkie, stłumione, krótkie pochłonięcie trafienia przez pole.',
    prompt: 'Soft energy shield absorbing a projectile hit with instant attack: very short muffled low thump with a faint quick electric fizz, damped and gentle, quick decay, no ringing, no glassy shimmer, subtle',
  },
  {
    id: 'zgrzyt', grupa: 'Kadłub i tarcza', nazwa: 'Zgrzyt kadłubów', s: 4,
    opis: 'Tarcie kadłubów przy zderzeniu.',
    prompt: 'Two huge metal ship hulls grinding and scraping against each other: deep groaning steel, screeching friction, stuttering slips, heavy and slow',
  },
  {
    id: 'taran', grupa: 'Kadłub i tarcza', nazwa: 'Taran', s: 3.5,
    opis: 'Zderzenie okrętów: zgniot, rwanie, jęk i odłamki.',
    prompt: 'Two massive starships colliding: enormous metal crunch, steel tearing and buckling, deep groan, debris scattering',
  },
  {
    id: 'trafienie', grupa: 'Kadłub i tarcza', nazwa: 'Trafienie pocisku w cel', s: 0.8,
    opis: 'Pocisk w kadłub wroga, słyszany z zewnątrz.',
    prompt: 'Kinetic projectile impact on a spaceship metal hull heard from outside with instant attack: short hard metallic crack with a burst of sparks and small debris, punchy and dry',
  },
  {
    id: 'trafieniePlazma', grupa: 'Kadłub i tarcza', nazwa: 'Trafienie plazmy w cel', s: 1.5,
    opis: 'Ciężki pocisk plazmowy (Yamato) w pancerz.',
    prompt: 'Heavy plasma bolt impact on thick metal armor with instant attack: searing burst, molten sizzle and a deep thud',
  },
  {
    id: 'tarczaWl', grupa: 'Kadłub i tarcza', nazwa: 'Tarcza — włączenie', s: 1.5,
    opis: 'Pole wstaje i stabilizuje się.',
    prompt: 'Starship energy shield powering up: quick rising electric hum that snaps into a stable shimmering field, sleek',
  },
  {
    id: 'tarczaWyl', grupa: 'Kadłub i tarcza', nazwa: 'Tarcza — wyłączenie', s: 1.2,
    opis: 'Pole gaśnie.',
    prompt: 'Starship energy shield powering down: shimmering field collapsing with a falling electric hum and a soft discharge, sleek',
  },
  {
    id: 'tarczaPekniecie', grupa: 'Kadłub i tarcza', nazwa: 'Tarcza — pęknięcie', s: 2,
    opis: 'Przeciążenie i zapadnięcie pola pod ostrzałem.',
    prompt: 'Energy shield overloading and collapsing under fire with instant attack: loud electric crack, shattering glassy burst and a crackling discharge fading out',
  },
  {
    id: 'uderzenieKadluba', grupa: 'Kadłub i tarcza', nazwa: 'Uderzenie kadłubów', s: 1.5,
    opis: 'Pierwszy kontakt dwóch kadłubów.',
    prompt: 'First contact slam of two huge metal starship hulls with instant attack: massive deep steel impact with a resonating boom, heavy',
  },
  {
    id: 'zgrzytPetla', grupa: 'Kadłub i tarcza', nazwa: 'Ocieranie kadłubów — pętla', s: 6, petla: true,
    opis: 'Ciągłe tarcie kadłubów, dopóki się stykają.',
    prompt: 'Continuous grinding of two huge metal ship hulls scraping along each other: deep groaning steel and steady screeching friction, constant intensity, seamless loop',
  },
  {
    id: 'zgniot', grupa: 'Kadłub i tarcza', nazwa: 'Miażdżenie kadłuba', s: 3,
    opis: 'Zgniatana sekcja: wyboczenie stali, pękające nity.',
    prompt: 'Starship hull section being crushed with instant attack: deep buckling steel, popping rivets, crunching structural collapse',
  },

  // ── Okręt ───────────────────────────────────────────────────────────────────────────────
  {
    id: 'rcs', grupa: 'Okręt', nazwa: 'Dysze manewrowe', s: 0.7,
    opis: 'Krótkie syknięcie gazu z dyszy SIDE.',
    prompt: 'Short burst of a maneuvering gas thruster: sharp pressurized hiss puff, dry and tight',
  },

  // ── Maskowanie ──────────────────────────────────────────────────────────────────────────
  {
    id: 'maskaWl', grupa: 'Maskowanie', nazwa: 'Maskowanie — włączenie', s: 2.5,
    opis: 'Fala przez kadłub, szklany połysk, cichy szum pola.',
    prompt: 'Cloaking device engaging: glassy shimmering wave sweeping across a surface, pitch sinking down into a soft quiet field hum, sleek',
  },
  {
    id: 'maskaWyl', grupa: 'Maskowanie', nazwa: 'Maskowanie — wyłączenie', s: 2,
    opis: 'Fala w drugą stronę i materializacja.',
    prompt: 'Cloaking device disengaging: shimmering glassy wave rising back up, soft materializing swell, sleek',
  },
  {
    id: 'maskaZerwanie', grupa: 'Maskowanie', nazwa: 'Maskowanie — zerwanie', s: 1.8,
    opis: 'Zakłócenie, trzask i spadek mocy.',
    prompt: 'Cloaking field breaking under fire: harsh glitching signal interference, electric snap and crackle, power dropping down',
  },

  // ── Warp ────────────────────────────────────────────────────────────────────────────────
  {
    id: 'warpSkok', grupa: 'Warp', nazwa: 'Warp — ładowanie i skok', s: 6,
    opis: 'Narastający dron, cewki, zassanie, cisza i skok.',
    prompt: 'Starship warp drive charging and jumping: deep rising drone with pulsing bass and whining coils for four seconds, brief suction into silence, then a huge whooshing bang as the ship shoots away',
  },
  {
    id: 'warpLot', grupa: 'Warp', nazwa: 'Warp — lot', s: 8, petla: true,
    opis: 'Szum przepływu i niski dron — pętla.',
    prompt: 'Inside a starship travelling through a warp tunnel: smooth rushing flow of energy, deep sub-bass drone with a slowly shimmering harmonic tone, no melody, seamless loop',
  },
  {
    id: 'warpWyjscie', grupa: 'Warp', nazwa: 'Warp — wyjście', s: 4,
    opis: 'Nadlatujący szum, hamowanie, gasnąca energia.',
    prompt: 'Starship dropping out of warp: fast incoming rushing whoosh, hard deceleration thump, energy winding down, faint ticking of cooling metal',
  },
  {
    id: 'przylot', grupa: 'Warp', nazwa: 'Przylot okrętu', s: 3,
    opis: 'Okręt wpada z daleka i gwałtownie hamuje.',
    prompt: 'Huge starship arriving from far away at extreme speed and braking hard right in front of the listener: doppler whoosh from the distance ending in a deep boom and a settling rumble',
  },

  // ── Interfejs ───────────────────────────────────────────────────────────────────────────
  {
    id: 'klik', grupa: 'Interfejs', nazwa: 'Klik', s: 0.5,
    opis: 'Przycisk, przełącznik.',
    prompt: 'Single soft tactile click of a military spaceship console button, short, clean and subtle, not retro',
  },
  {
    id: 'potwierdzenie', grupa: 'Interfejs', nazwa: 'Potwierdzenie', s: 0.6,
    opis: 'Rozkaz przyjęty.',
    prompt: 'Short positive confirmation sound of a military starship interface: two quick soft rising tones, clean and subtle, not retro',
  },
  {
    id: 'blad', grupa: 'Interfejs', nazwa: 'Odmowa', s: 0.6,
    opis: 'Nie da się (brak amunicji, poza łukiem).',
    prompt: 'Short denied sound of a military starship interface: low muted double tone, clean, not harsh, not retro',
  },
  {
    id: 'namiar', grupa: 'Interfejs', nazwa: 'Namiar celu', s: 2.5,
    opis: 'Coraz szybsze sygnały i ciągły ton namiaru.',
    prompt: 'Target lock-on sequence of military avionics: accelerating radar beeps that merge into a solid steady lock tone, clean',
  },
  {
    id: 'malowanie', grupa: 'Interfejs', nazwa: 'Malowanie celu', s: 0.5,
    opis: 'Cel dopisany do kolejki (T).',
    prompt: 'Very short target designation blip of a military targeting computer: single crisp high tick with a soft tail',
  },
  {
    id: 'grupa', grupa: 'Interfejs', nazwa: 'Zmiana grupy broni', s: 0.6,
    opis: 'Mechaniczny przeskok i krótki sygnał.',
    prompt: 'Weapon group selector switching: chunky mechanical clunk followed by a tiny short electronic chirp',
  },
  {
    id: 'alarm', grupa: 'Interfejs', nazwa: 'Alarm', s: 3, petla: true,
    opis: 'Kadłub krytyczny — klakson dwutonowy, pętla.',
    prompt: 'Warship critical damage alarm: urgent two-tone klaxon repeating, heard inside a metal bridge, seamless loop',
  },

  // ── Tło ─────────────────────────────────────────────────────────────────────────────────
  {
    id: 'mostek', grupa: 'Tło', nazwa: 'Mostek — tło', s: 10, petla: true,
    opis: 'Buczenie zasilania, wentylacja, odgłosy komputerów, jęki kadłuba — pętla.',
    prompt: 'Ambience of a large warship bridge in space: steady low power hum, quiet ventilation airflow, occasional soft computer chirps and faint distant hull creaks, calm, seamless loop',
  },
];
