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
];
