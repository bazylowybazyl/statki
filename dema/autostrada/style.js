// dema/autostrada/style.js — rejestr stylów wyglądu (kolejność = klawisze 1–9). Styl: utworz(ctx) → { id, nazwa, opis, siatki, aktualizuj(klatka) }.
import { utworzKlisze } from './styl-klisza.js';
import { utworzLampy } from './styl-lampy.js';
import { utworzMalowanie } from './styl-malowanie.js';
import { utworzNawe } from './styl-nawa.js';

export const STYLE = [utworzKlisze, utworzLampy, utworzMalowanie, utworzNawe];
