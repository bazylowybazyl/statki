// node --import ./experiments/rust-beams/js/register.mjs … — podmiana modułów silnika belek na wersje spike'u.
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
