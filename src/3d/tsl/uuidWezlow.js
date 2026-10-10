// src/3d/tsl/uuidWezlow.js
//
// Niepowtarzalne uuid węzłów TSL i strażnik kolizji (pułapka 38, 2026-10-09).
//
// three r183 skleja węzły w budowie programu PO UUID: `Node.getShared` (domyślne `getHash` = `uuid`)
// i `UniformNode.generate` (`getUniformHash` — uuid węzła, a w TextureNode uuid TEKSTURY) szukają w jednym
// słowniku buildera `hashNodes`. Dwa RÓŻNE obiekty z tym samym uuid = drugi dostaje w shaderze kod pierwszego —
// bez żadnego błędu: stała 1/N zamiast `f32(instanceIndex)`, `vec3(f32(instanceIndex))` zamiast `vec3(0.5)`,
// a przy węźle podmienionym na przodka / parametr funkcji — błędy budowy („cannot assign to parameter”,
// „Maximum call stack size exceeded … ConditionalNode”, zły typ działania).
//
// uuid to 4 × Math.random (MathUtils.generateUUID). W przeglądarce bez harnessu się nie powtarza; powtarza
// się, gdy Math.random wraca do tego samego stanu — harness (`scripts/webgpu/harness-strona.js`) ma Math.random
// z ziarnem, a `reseed(v)` z ziarnem startu strony (0x5eed1234 — wybuchy-demo / wybuchy-sonda) albo tym samym
// ziarnem drugi raz odtwarza ciąg: węzeł zbudowany po `reseed` dostaje uuid węzła sprzed niego. Skażone
// wychodzą materiały i kernele budowane PO `reseed` (sonda gazu, rozgrzewka modułu, pierwszy wybuch), które
// sięgają do węzłów sprzed niego (wspólne podgrafy, uniformy, `instanceIndex` itp.).
//
// Łata (zawsze, także w grze bez harnessu):
//  1. `MathUtils.generateUUID` (woła go TYLKO Node — reszta three importuje funkcję wprost) dokleja licznik:
//     uuid węzła jest niepowtarzalny w obrębie strony niezależnie od Math.random. Te same 4 losowania co three —
//     ciąg Math.random harnessu (świat gry, bazy zrzutów) bez zmian.
//  2. Strażnik w `Node.getShared` i `UniformNode.getUniformHash`: węzeł trafia na INNY obiekt z tym samym uuid
//     (albo tekstura na inną teksturę z tym samym uuid — Texture.uuid łata 1 nie obejmuje) → licznik, raz
//     `console.error` (harness łapie go jako błąd) i węzeł budowany osobno.
// `globalThis.__TSL_UUID_NAPRAWA = false` przed wczytaniem strony: bez łaty 1 i bez naprawy — strażnik tylko
// liczy (A/B: `node scripts/webgpu/tsl-uuid-gra.mjs`). Stan: `tslUuidStan` (Core3D.tslUuid, window.__tslUuid).

import { MathUtils, Node, TextureNode, UniformNode } from 'three/webgpu';

const NAPRAWA = globalThis.__TSL_UUID_NAPRAWA !== false;

export const tslUuidStan = {
  naprawa: NAPRAWA,
  kolizje: 0,
  wezly: 0,
  uniformy: 0,
  tekstury: 0,
  // pierwsze kolizje: { rodzaj, wezel, zastapiony, uuid, budowa }
  pierwsze: []
};

const PIERWSZE_MAX = 16;
let _zainstalowane = false;
let _licznik = 0;

function opisBudowy(builder) {
  const m = builder.material;
  const o = builder.object;
  if (m) return `${m.type}${m.name ? ' „' + m.name + '”' : ''}${o?.name ? ' @ ' + o.name : ''}`;
  if (o?.isComputeNode) return `compute${o.name ? ' „' + o.name + '”' : ''} (${o.count})`;
  return o ? (o.name || o.type || o.constructor?.name || '?') : '?';
}

function zglos(rodzaj, wezel, zastapiony, uuid, builder) {
  const s = tslUuidStan;
  s.kolizje++;
  s[rodzaj]++;
  if (s.pierwsze.length < PIERWSZE_MAX) {
    const wpis = { rodzaj, wezel: wezel.type || wezel.constructor?.name, zastapiony: zastapiony.type || zastapiony.constructor?.name, uuid, budowa: opisBudowy(builder) };
    s.pierwsze.push(wpis);
    if (s.pierwsze.length <= 3) {
      console.error(`[Core3D] kolizja uuid w budowie TSL (${rodzaj}): ${wpis.wezel} trafił na ${wpis.zastapiony} ${uuid} — ${wpis.budowa}`
        + (s.naprawa ? ' (zbudowany osobno)' : ' (BEZ NAPRAWY — WGSL skażony)'));
    }
  }
}

export function zainstalujUuidWezlow() {
  if (_zainstalowane) return tslUuidStan;
  _zainstalowane = true;

  if (NAPRAWA) {
    const generuj = MathUtils.generateUUID;
    MathUtils.generateUUID = function generateUUIDWezla() {
      _licznik++;
      return `${generuj()}-${_licznik.toString(36)}`;
    };
    // Bez węzła próbnego (zużyłby 4 losowania harnessu). three po aktualizacji mógłby brać uuid węzła
    // z importowanej funkcji — wtedy łata 1 nic nie robi (zostaje strażnik); pilnuje tego tests/tslUuid.test.mjs.
  }

  const proto = Node.prototype;
  const getShared = proto.getShared;
  proto.getShared = function getSharedBezKolizji(builder) {
    const shared = getShared.call(this, builder);
    if (shared !== this && shared.uuid === this.uuid) {
      zglos('wezly', this, shared, this.uuid, builder);
      if (NAPRAWA) return this;
    }
    return shared;
  };

  // UniformNode.generate dzieli uniform z węzłem spod tego samego haszu. TextureNode ma własne getUniformHash
  // (uuid TEKSTURY) — łata na obu prototypach (podklasy gry: HullObjectTextureNode, teksturaObiektu… dziedziczą).
  const straznikUniformu = (getUniformHash) => function getUniformHashBezKolizji(builder) {
    const hash = getUniformHash.call(this, builder);
    const shared = builder.getNodeFromHash(hash);
    if (shared === undefined || shared === this) return hash;
    if (this.isTextureNode === true) {
      const tex = this.value;
      // węzeł TEJ SAMEJ tekstury — wspólny uniform z założenia; inna tekstura (albo nie-tekstura) z tym uuid — kolizja
      if (tex && hash === tex.uuid && !(shared.isTextureNode === true && shared.value === tex)) {
        zglos('tekstury', this, shared, hash, builder);
        if (NAPRAWA) return `${hash}#t${tex.id}`;
      }
    } else if (hash === this.uuid && shared.uuid === hash) {
      zglos('uniformy', this, shared, hash, builder);
      if (NAPRAWA) return `${hash}#n${this.id}`;
    }
    return hash;
  };
  UniformNode.prototype.getUniformHash = straznikUniformu(UniformNode.prototype.getUniformHash);
  TextureNode.prototype.getUniformHash = straznikUniformu(TextureNode.prototype.getUniformHash);

  return tslUuidStan;
}

// Przy pierwszym imporcie (Core3D importuje ten moduł PRZED resztą swoich zależności — węzły tworzone
// w modułach Core3D i później dostają już licznik).
zainstalujUuidWezlow();
if (typeof window !== 'undefined') window.__tslUuid = tslUuidStan;
