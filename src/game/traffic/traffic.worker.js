/**
 * Worker ruchu v2 — cienka powłoka na `trafficCore.js`.
 *
 * Cała logika jest w rdzeniu, żeby tryb awaryjny na głównym wątku
 * (`TrafficBridge` bez workera) i testy w Node szły tą samą ścieżką.
 */

import { createTrafficCore } from './trafficCore.js';

const core = createTrafficCore((message, transfer) => self.postMessage(message, transfer || []));

self.onmessage = (event) => core.handle(event.data);
