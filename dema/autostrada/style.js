// dema/autostrada/style.js — rejestr stylów wyglądu (kolejność = klawisze 1–9). Styl: utworz(ctx) → { id, nazwa, opis, siatki, aktualizuj(klatka) }.
// Styl może prosić o inny ŚWIAT (układ sieci z własnym ruchem i bazą obrazu): `utworz.swiat = 'rama'`; domyślnie 'pierscien'.
import { utworzKlisze } from './styl-klisza.js';
import { utworzLampy } from './styl-lampy.js';
import { utworzMalowanie } from './styl-malowanie.js';
import { utworzNawe } from './styl-nawa.js';
import { utworzRame } from './styl-rama.js';

export const STYLE = [utworzKlisze, utworzLampy, utworzMalowanie, utworzNawe, utworzRame];
