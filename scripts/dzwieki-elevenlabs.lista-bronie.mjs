// Dźwięki uzbrojenia (rodziny broni × wielkość, wiązki, superbronie) do generatora ElevenLabs — dołączane do listy
// `scripts/dzwieki-elevenlabs.lista.mjs` jednym importem. Mapa broń → dźwięk: `src/audio/dzwiekiBroni.js`.
//
// Zasady opisów (oceny użytkownika w scenie dźwięków, 2026-11-11, reguła `dzwiek`):
// - wystrzały i trafienia „with instant attack” — strzał ma trafiać w chwilę wystrzału (atak ≤ ~60 ms, mierzony);
// - bez „massive / huge / cinematic / thunderous” (wychodzi przesadzone), bez „dull thud / boom / resonating” (wychodzi
//   bęben), bez „muffled / subtle” (wychodzi za delikatnie); krótkie, wyraźne, twarde; „mid-range, no bass boom” przy
//   spokojniejszych;
// - jedna rodzina ma wspólny rdzeń opisu, wielkość S / M / L / Capital zmienia ciężar (kaliber, gęstość środka, ogon),
//   nie charakter — ta sama rodzina brzmi spójnie, większa broń ciężej.
// Flak: pierwsze wersje bez „loud and close” wychodziły ciche i szpiczaste (RMS −28…−34 dBFS przy szczycie −10…−16 —
// wyrównanie nie dociąga ich do kategorii, bo sufit szczytu); rozerwanie „at a distance” — cisza albo późny atak.
// Styl doklejany do opisu: `STYL_BRONI` (pole `styl` wpisu — skrypt bierze je zamiast wspólnego STYL listy, który ma
// słowo „cinematic”).

export const STYL_BRONI = 'Sound effect for a space warship game, close and dry, high fidelity, no music, no voices.';

const B = (o) => ({ grupa: 'Uzbrojenie', warianty: 3, styl: STYL_BRONI, ...o });

export const DZWIEKI_BRONI = [
  // ── Działka (autocannon, Goliath): S kanonierka, M Heavy Autocannon, L Oblężniczy, Capital Goliath ─────────────
  B({
    id: 'dzialkoS', nazwa: 'Działko S', s: 0.6,
    opis: 'Lekkie działko: krótki trzask i klik zamka (Działko kanonierki).',
    prompt: 'Single shot of a light rapid-fire ship autocannon with instant attack: short sharp metallic crack, snappy mechanical clack, small caliber, bright and tight, mid-range, no bass boom',
  }),
  B({
    id: 'dzialkoM', nazwa: 'Działko M', s: 0.7,
    opis: 'Średnie działko: twardy trzask i zamek (Heavy Autocannon).',
    prompt: 'Single shot of a medium ship autocannon with instant attack: hard punchy crack, crisp mechanical bolt clack, medium caliber, tight and dry',
  }),
  B({
    id: 'dzialkoL', nazwa: 'Działko L', s: 0.9,
    opis: 'Ciężkie działko: twardy trzask z krótkim środkiem (Heavy Autocannon — Oblężniczy).',
    prompt: 'Single shot of a heavy ship autocannon with instant attack: heavy hard crack with a short punchy low-mid body, solid mechanical bolt clack, large caliber, tight, quick decay',
  }),
  B({
    id: 'dzialkoC', nazwa: 'Działko Capital (Goliath)', s: 1.1,
    opis: 'Działko okrętu kapitałowego: ciężki trzask, gęsty środek, podajnik (Goliath).',
    prompt: 'Single shot of a capital-ship heavy rotary autocannon with instant attack: very heavy hard crack, dense low-mid punch, mechanical feed clank, large shell, tight and quick decay, no long tail',
  }),

  // ── Armata ──────────────────────────────────────────────────────────────────────────────────────────────────
  B({
    id: 'armataL', nazwa: 'Armata L', s: 1.5,
    opis: 'Armata Oblężnicza: trzask wylotu, gęsty środek, zamek.',
    prompt: 'Single shot of a heavy siege cannon on a space warship with instant attack: hard sharp muzzle crack with a dense low-mid punch, short metallic breech clank after, tight, no long rumble',
  }),

  // ── Helios (pociski plazmy) i Plasma Gatling ──────────────────────────────────────────────────────────────────
  B({
    id: 'heliosS', nazwa: 'Helios S', s: 0.6,
    opis: 'Lekki pocisk plazmy: jasny trzask i krótkie skwierczenie.',
    prompt: 'Single plasma bolt fired from a light energy turret with instant attack: sharp bright electric zap with a short hot sizzle, snappy, mid-high range, not retro, not 8-bit',
  }),
  B({
    id: 'heliosM', nazwa: 'Helios M', s: 0.8,
    opis: 'Pocisk plazmy: trzask wyładowania, syk plazmy.',
    prompt: 'Single plasma bolt fired from a medium energy turret with instant attack: crisp electric crack, hot plasma sizzle, short fizzing tail, mid-range, not retro, not 8-bit',
  }),
  B({
    id: 'heliosL', nazwa: 'Helios L (Lance)', s: 1,
    opis: 'Ciężki pocisk plazmy: twardy trzask, gęsty wybuch plazmy, krótki ogon.',
    prompt: 'Single heavy plasma lance bolt fired from a large energy turret with instant attack: hard electric crack with a dense searing plasma burst and a short sizzling tail, mid-range, not retro',
  }),
  B({
    id: 'plazmaGatling', nazwa: 'Plasma Gatling (Capital)', s: 0.7,
    opis: 'Obrotowe działo plazmowe: twardy trzask i gorące kopnięcie plazmy.',
    prompt: 'Single shot of a capital-ship rotary plasma cannon with instant attack: hard electric crack with a hot plasma punch, quick mechanical spin click, dense mid-range, short tail, not retro',
  }),
  B({
    id: 'yamatoL', nazwa: 'Yamato L (dwulufowa)', s: 1.6,
    opis: 'Lufa baterii dwulufowej: trzask, gęsty wybuch plazmy, krótki ogon (lżej niż Yamato).',
    prompt: 'Single barrel of a heavy plasma main battery on a warship firing with instant attack: hard electric crack, searing plasma blast with a dense low-mid punch, short rolling tail, no sub-bass rumble',
  }),

  // ── Działa szynowe snajperskie (Valkyrie, Lanca — ta sama receptura obrazu): S Kolec, M Oszczep / Lanca, L Lanca Ciężka, Capital Valkyrie
  B({
    id: 'snajperS', nazwa: 'Railgun snajperski S', s: 0.7,
    opis: 'Lekki railgun osiowy: ostry trzask, smagnięcie pocisku (Kolec).',
    prompt: 'Light axial railgun shot with instant attack: very sharp electric crack, fast metallic slug snap, high-velocity whip, bright and tight, mid-high range, no charge-up',
  }),
  B({
    id: 'snajperM', nazwa: 'Railgun snajperski M', s: 1,
    opis: 'Railgun średni: gwałtowny trzask, trzask pocisku, krótkie dzwonienie szyn (Oszczep, Lanca).',
    prompt: 'Medium railgun sniper shot with instant attack: violent sharp electric crack, metallic slug snap, quick ringing of the rails, tight, no charge-up',
  }),
  B({
    id: 'snajperL', nazwa: 'Railgun snajperski L', s: 1.3,
    opis: 'Ciężki railgun z długą lufą: twarde kopnięcie, dzwonienie szyn (Lanca Ciężka).',
    prompt: 'Heavy long-barrel railgun shot with instant attack: very hard electric crack, heavy kinetic snap, bright metallic ringing of the rails fading quickly, no charge-up',
  }),
  B({
    id: 'snajperC', nazwa: 'Railgun snajperski Capital (Valkyrie)', s: 1.6,
    opis: 'Railgun okrętu kapitałowego: bardzo twardy trzask, gęste kopnięcie, wyładowanie (Valkyrie).',
    prompt: 'Capital-ship railgun shot with instant attack: extremely hard electric crack with a dense kinetic punch, heavy metallic rail ringing and a short crackling discharge tail, no charge-up',
  }),

  // ── Superbronie: ładowanie i strzał osobno (moment strzału z gry) ─────────────────────────────────────────────
  B({
    id: 'mjolnirLadowanie', nazwa: 'Mjolnir — ładowanie (3 s)', s: 3.2, warianty: 2,
    opis: 'Narastanie przez całe ładowanie 3 s, bez strzału (przerwane ruchem — gaśnie).',
    prompt: 'Giant siege railgun charging up: low electric hum rising steadily in pitch and intensity with accelerating capacitor pulses and crackling sparks for three seconds, ends at full tension without firing',
  }),
  B({
    id: 'mjolnirStrzal', nazwa: 'Mjolnir — strzał', s: 2.2,
    opis: 'Strzał po naładowaniu: atak od pierwszej próbki, kopnięcie, dzwonienie szyn.',
    prompt: 'Giant siege railgun firing with instant attack: extremely hard electric crack, heavy kinetic punch, bright metallic rail ringing and a crackling discharge tail, no charge-up',
  }),
  B({
    id: 'hexlanceLadowanie', nazwa: 'Hexlance — ładowanie (1,2 s)', s: 1.4, warianty: 2,
    opis: 'Narastanie przez ładowanie 1,2 s (pierwsze wciśnięcie 4).',
    prompt: 'Superweapon lance charging: fast rising electric whine with crackling sparks and a building energy hum for one second, ends at peak tension without firing',
  }),
  B({
    id: 'hexlanceGotowy', nazwa: 'Hexlance — naładowany (pętla)', s: 3, petla: true, warianty: 2,
    opis: 'Okno strzału po naładowaniu (do 5 s): napięte buczenie — pętla.',
    prompt: 'Fully charged superweapon idling: steady tense high-energy hum with a soft pulsing electric crackle, stable intensity, seamless loop',
  }),
  B({
    id: 'hexlanceStrzal', nazwa: 'Hexlance — strzał', s: 2,
    opis: 'Wyładowanie lancy (drugie wciśnięcie 4): przenikliwy trzask, gęsty wybuch energii, skwierczący ogon.',
    prompt: 'Superweapon lance discharge with instant attack: piercing hard electric crack, searing energy blast with a dense low-mid punch and a long crackling sizzle tail, no charge-up',
  }),
  B({
    id: 'promienLadowanie', nazwa: 'Promień śmierci — ładowanie (4 s)', s: 4.2, warianty: 2,
    opis: 'Gungnir (Colossus Terran, tylko NPC): narastanie przez ładowanie 4 s.',
    prompt: 'Capital-ship beam cannon charging: deep power hum rising steadily with a building electric whine and crackling arcs for four seconds, ends at full tension without firing',
  }),
  B({
    id: 'promienStrzal', nazwa: 'Promień śmierci — strzał', s: 3, warianty: 2,
    opis: 'Gungnir: trzask i ryczący promień przez ~2 s, ostre ucięcie.',
    prompt: 'Capital-ship beam cannon firing with instant attack: hard electric crack into a searing roaring energy beam with crackling arcs for two seconds, then a fast cutoff',
  }),

  // ── Wiązki ────────────────────────────────────────────────────────────────────────────────────────────────────
  B({
    id: 'wiazkaStart', nazwa: 'Wiązka ciągła — zapłon', s: 0.7,
    opis: 'Początek wiązki ciągłej (potem pętla `wiazka`).',
    prompt: 'Energy beam weapon igniting with instant attack: sharp electric snap into a searing hum, short, mid-range',
  }),
  B({
    id: 'wiazkaPuls', nazwa: 'Wiązka puls', s: 0.7,
    opis: 'Jeden impuls lasera wiązkowego (Laser Wiązkowy — Puls).',
    prompt: 'Single pulse of a beam laser weapon with instant attack: short searing energy burst with a crisp electric crackle, mid-range, not retro, not 8-bit',
  }),
  B({
    id: 'wiazkaKadlub', nazwa: 'Wiązka w kadłub — pętla', s: 3, petla: true, warianty: 2,
    opis: 'Skwierczenie metalu w miejscu trafienia wiązki, dopóki trafia.',
    prompt: 'Energy beam cutting into thick metal armor: steady searing sizzle, crackling sparks and hissing molten metal, constant intensity, seamless loop, mid-range',
  }),
  B({
    id: 'wiazkaTarcza', nazwa: 'Wiązka w tarczę — pętla', s: 3, petla: true, warianty: 2,
    opis: 'Trzaski i brzęczenie pola w miejscu trafienia wiązki w tarczę.',
    prompt: 'Energy beam pressing against an energy shield: steady electric crackling and buzzing interference, fizzing static, constant intensity, seamless loop, mid-range',
  }),

  // ── Flak: sam strzał (rozerwania osobno — `flakRozprysk` przy zapalniku) ─────────────────────────────────────
  B({
    id: 'flakS', nazwa: 'Flak S', s: 0.6,
    opis: 'Lekki flak: krótki trzask (Kartacz Lekki).',
    prompt: 'Single shot of a light flak gun on a warship with instant attack: sharp punchy crack, small caliber, loud and close, tight, no explosions, mid-range',
  }),
  B({
    id: 'flakM', nazwa: 'Flak M', s: 0.8,
    opis: 'Flak średni: twardy trzask z krótkim środkiem (Kartacz Średni).',
    prompt: 'Single shot of a medium flak cannon with instant attack: punchy hard crack with a short low-mid body, tight, no explosions',
  }),
  B({
    id: 'flakL', nazwa: 'Flak L', s: 1,
    opis: 'Ciężki flak: twardy trzask, gęsty środek, klik zamka (Grad).',
    prompt: 'Single shot of a heavy flak cannon with instant attack: heavy hard crack with a dense low-mid punch and a quick metallic clank, loud and close, tight, no explosions',
  }),
  B({
    id: 'flakC', nazwa: 'Flak Capital (Perun)', s: 1.2,
    opis: 'Bateria flak okrętu kapitałowego: dwie lufy prawie naraz (Perun).',
    prompt: 'Single salvo of a capital-ship flak battery with instant attack: two barrels firing almost together, very hard cracks with dense low-mid punch, loud and close, tight, no explosions',
  }),
  B({
    id: 'flakRozprysk', nazwa: 'Flak — rozerwanie', s: 0.6,
    opis: 'Rozerwanie pocisku flak (zapalnik): suchy trzask i odłamki.',
    prompt: 'Single flak shell airburst with instant attack: loud sharp dry crack-pop with a short crackle of shrapnel, mid-range, no bass boom',
  }),

  // ── Rakiety i torpedy (start każdej rakiety) ──────────────────────────────────────────────────────────────────
  B({
    id: 'rakietaS', nazwa: 'Rakieta S', s: 1.2,
    opis: 'Mała szybka rakieta: pyknięcie wyrzutu, syk zapłonu, świst (Osa, Rój, Fast Missile, torpeda lotnicza).',
    prompt: 'Small fast missile launching from a warship launcher with instant attack: sharp pneumatic pop, quick hissing rocket ignition and a fast whoosh flying away, light, mid-high range',
  }),
  B({
    id: 'rakietaL', nazwa: 'Rakieta L', s: 2,
    opis: 'Ciężka rakieta salwowa: trzask wyrzutu, ryk silnika, ciężki świst (Grad).',
    prompt: 'Heavy rocket launching from a salvo launcher with instant attack: hard launch crack, roaring rocket motor ignition and a heavy whoosh flying away, tight',
  }),
  B({
    id: 'torpeda', nazwa: 'Torpeda L', s: 2.2,
    opis: 'Torpeda z wyrzutni: hydrauliczny klak, wyrzut gazu, zapłon silnika (Siege Torpedo, Torpedo Salvo).',
    prompt: 'Heavy torpedo launching from a warship tube with instant attack: hard hydraulic clunk, pressurized gas blast, roaring torpedo motor ignition fading away, low-mid, no sub-bass',
  }),
  B({
    id: 'torpedaC', nazwa: 'Torpeda Capital', s: 2.5,
    opis: 'Torpeda oblężnicza okrętu kapitałowego: cięższy klak i wyrzut (Siege Torpedo Mk II).',
    prompt: 'Capital-ship siege torpedo launching with instant attack: very hard hydraulic clunk, heavy pressurized gas blast, deep roaring motor ignition fading away, dense low-mid, no sub-bass rumble',
  }),
];
