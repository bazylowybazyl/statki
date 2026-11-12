/**
 * Worker ruchu v2 — cienka powłoka na `trafficCore.js`.
 *
 * Cała logika jest w rdzeniu, żeby tryb awaryjny na głównym wątku
 * (`TrafficBridge` bez workera) i testy w Node szły tą samą ścieżką.
 */

import { createTrafficCore } from './trafficCore.js';

// Rozgrzewka świata (E15) oddaje sterowanie między kawałkami przez kanał wiadomości, nie `setTimeout(0)`:
// zagnieżdżone timeouty przeglądarka przycina do 4 ms (przy kawałkach po ~12 ms to ćwierć straty). Wiadomość
// kanału staje w kolejce ZA wiadomościami gry, które już czekają — te przechodzą między kawałkami.
const channel = typeof MessageChannel === 'function' ? new MessageChannel() : null;
const queued = [];
if (channel) channel.port1.onmessage = () => queued.shift()?.();
const schedule = channel
  ? (fn) => { queued.push(fn); channel.port2.postMessage(0); }
  : (fn) => setTimeout(fn, 0);

const core = createTrafficCore((message, transfer) => self.postMessage(message, transfer || []), { schedule });

self.onmessage = (event) => core.handle(event.data);
