// src/3d/tsl/kluczSwiatel.js
//
// Klucz węzła świateł bez przeliczania przy każdym renderze (port WebGPU, zadanie 23 — duża bitwa).
//
// three r183 (NodeManager.getCacheKey) liczy przy KAŻDYM renderer.render() klucz środowiska sceny:
// `lightsNode.getCacheKey(true)` — wymuszone przejście przez węzły-dzieci (węzły właściwości TSL owinięte
// w Proxy) — ~10–15 µs CPU na render. Klatka gry to ~20 renderów (passy sceny, 12 passów bloomu, post,
// maska słońca, gęstość dymu rakiet, zniekształcenia); w poście i bloomie (QuadMesh) to zawsze ten sam
// pusty LightsNode (Lighting.getNode: scene.isQuadMesh → wspólny węzeł bez świateł).
//
// Wynik zależy tylko od dzieci węzła (stałe węzły właściwości totalDiffuse / totalSpecular / outgoingLight:
// klucz z typu, nazwy i flagi varying) i od customCacheKey (każde światło: id, castShadow, dla reflektora
// mapa i colorNode). Tu wynik jest pamiętany razem z podpisem tych danych — TEN SAM klucz, liczony od nowa
// tylko przy zmianie podpisu. Węzeł z innym zestawem dzieci (ktoś dopisał węzeł) i wywołania z `ignores`
// (przejście klucza z zewnątrz) idą oryginalną ścieżką three.

import { LightsNode } from 'three/webgpu';

const DZIECI = ['totalDiffuseNode', 'totalSpecularNode', 'outgoingLightNode'];
const _orig = LightsNode.prototype.getCacheKey;

// Czy własne pola węzła, które three przechodzi w kluczu (bez „_”, węzły / tablice / zwykłe obiekty),
// to dokładnie trzy znane węzły właściwości.
function dzieciZnane(node) {
  const names = Object.getOwnPropertyNames(node);
  let known = 0;
  for (let i = 0; i < names.length; i++) {
    const p = names[i];
    if (p.charCodeAt(0) === 95) continue; // '_'
    const v = node[p];
    if (v === null || typeof v !== 'object') continue;
    if (DZIECI.indexOf(p) >= 0 && v.isNode === true) { known++; continue; }
    // inny węzeł, tablica albo obiekt z węzłami — nie wiemy, co three z nich złoży
    if (v.isNode === true || Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype) return false;
  }
  return known === DZIECI.length;
}

// Podpis: wersja węzła, dzieci (obiekt, wersja, nazwa, varying), światła (id, castShadow, reflektor: mapa,
// klucz colorNode). Zapis w miejscu (bez alokacji na render); zwraca true, gdy podpis się nie zmienił.
let _s = null;
let _i = 0;
let _same = true;
function put(v) {
  if (_same && (_i >= _s.length || _s[_i] !== v)) _same = false;
  _s[_i++] = v;
}
function podpisBezZmian(node) {
  _s = node.__kluczPodpis || (node.__kluczPodpis = []);
  _i = 0;
  _same = true;
  put(node.version);
  for (let k = 0; k < DZIECI.length; k++) {
    const c = node[DZIECI[k]];
    put(c);
    put(c.version);
    put(c.name);
    put(c.varying);
  }
  const lights = node._lights;
  put(lights.length);
  for (let k = 0; k < lights.length; k++) {
    const light = lights[k];
    put(light.id);
    put(light.castShadow ? 1 : 0);
    if (light.isSpotLight === true) {
      put(light.map !== null ? light.map.id : -1);
      put(light.colorNode ? light.colorNode.getCacheKey() : -1);
    }
  }
  if (_s.length !== _i) { _s.length = _i; _same = false; }
  const same = _same;
  _s = null;
  return same;
}

/** Liczniki (testy, diagnostyka): klucz z pamięci / przeliczony / ścieżka three bez pamięci. */
export const statKluczSwiatel = { zPamieci: 0, przeliczenia: 0, oryginal: 0 };

/** Klucz jak LightsNode.getCacheKey(force) three r183 — pamiętany, dopóki podpis świateł i dzieci się nie zmieni. */
function getCacheKeyPamietany(force = false, ignores = null) {
  if (ignores !== null || !dzieciZnane(this)) {
    statKluczSwiatel.oryginal++;
    return _orig.call(this, force, ignores);
  }
  if (podpisBezZmian(this) && this.__kluczWart !== undefined) {
    // skutki uboczne jak po wymuszonym przeliczeniu: klucz i jego wersja w węźle
    this._cacheKey = this.__kluczWart;
    this._cacheKeyVersion = this.version;
    statKluczSwiatel.zPamieci++;
    return this.__kluczWart;
  }
  const key = _orig.call(this, true, null);
  this.__kluczWart = key;
  statKluczSwiatel.przeliczenia++;
  return key;
}

/** Instalacja (raz, przy tworzeniu renderera Core3D). */
export function zainstalujKluczSwiatel() {
  if (LightsNode.prototype.getCacheKey === getCacheKeyPamietany) return false;
  LightsNode.prototype.getCacheKey = getCacheKeyPamietany;
  return true;
}

/** Oryginał three (testy: porównanie kluczy). */
export const kluczSwiatelOryginal = _orig;
