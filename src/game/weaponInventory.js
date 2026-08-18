/**
 * Inwentarz broni z licznikami sztuk.
 *
 * Wcześniej `ship.inventory` było zwykłym `Set<weaponId>` — miało się broń albo
 * nie. Przy takim modelu drugi railgun wyciągnięty z wraku nie znaczył nic.
 *
 * Klasa jest CELOWO zgodna z interfejsem Set (`has`, `add`, `delete`, `size`,
 * iterator), żeby istniejące miejsca — `inventory.has(id)`, `[...inventory]`,
 * `Array.from(inventory)` — działały bez zmian. Nowe API to `count`/`take`/`give`.
 *
 * Semantyka: inwentarz to broń W ŁADOWNI, nie na kadłubie. Montaż zabiera sztukę,
 * demontaż ją zwraca. Dzięki temu zmiana uzbrojenia jest realnym wyborem, a nie
 * dowolnym przekładaniem.
 */

export class WeaponInventory {
  /** @param {Iterable<string>|Record<string, number>|WeaponInventory} [source] */
  constructor(source = null) {
    this._counts = new Map();
    if (source) this.merge(source);
  }

  // --- API zgodne z Set ---

  has(weaponId) {
    return this.count(weaponId) > 0;
  }

  add(weaponId, amount = 1) {
    this.give(weaponId, amount);
    return this;
  }

  /** Usuwa WSZYSTKIE sztuki danej broni (semantyka Set.delete). */
  delete(weaponId) {
    return this._counts.delete(String(weaponId));
  }

  clear() {
    this._counts.clear();
  }

  /** Liczba RÓŻNYCH typów broni, nie sztuk — jak w Set. */
  get size() {
    let n = 0;
    for (const amount of this._counts.values()) if (amount > 0) n++;
    return n;
  }

  *[Symbol.iterator]() {
    for (const [id, amount] of this._counts) {
      if (amount > 0) yield id;
    }
  }

  values() {
    return this[Symbol.iterator]();
  }

  keys() {
    return this[Symbol.iterator]();
  }

  forEach(callback, thisArg) {
    for (const id of this) callback.call(thisArg, id, id, this);
  }

  // --- Liczniki ---

  count(weaponId) {
    return Math.max(0, Number(this._counts.get(String(weaponId))) || 0);
  }

  /** Dokłada sztuki. Zwraca nowy stan. */
  give(weaponId, amount = 1) {
    const id = String(weaponId || '');
    if (!id) return 0;
    const delta = Math.max(0, Math.floor(Number(amount) || 0));
    if (delta <= 0) return this.count(id);
    const next = this.count(id) + delta;
    this._counts.set(id, next);
    return next;
  }

  /**
   * Wyjmuje sztuki, jeśli są. Zwraca `true` tylko przy pełnym pokryciu —
   * nigdy nie wydaje częściowo, żeby montaż nie zostawiał połowy działa.
   */
  take(weaponId, amount = 1) {
    const id = String(weaponId || '');
    const want = Math.max(0, Math.floor(Number(amount) || 0));
    if (!id || want <= 0) return false;
    const held = this.count(id);
    if (held < want) return false;
    const next = held - want;
    if (next > 0) this._counts.set(id, next);
    else this._counts.delete(id);
    return true;
  }

  /** Ustawia stan wprost — do wczytywania zapisów i narzędzi deweloperskich. */
  set(weaponId, amount) {
    const id = String(weaponId || '');
    if (!id) return;
    const next = Math.max(0, Math.floor(Number(amount) || 0));
    if (next > 0) this._counts.set(id, next);
    else this._counts.delete(id);
  }

  /** Przyjmuje Set, tablicę id, obiekt {id: ile} albo inny WeaponInventory. */
  merge(source) {
    if (!source) return this;
    if (source instanceof WeaponInventory) {
      for (const [id, amount] of source._counts) this.give(id, amount);
      return this;
    }
    if (typeof source[Symbol.iterator] === 'function') {
      for (const entry of source) {
        if (Array.isArray(entry)) this.give(entry[0], entry[1]);
        else this.give(entry, 1);
      }
      return this;
    }
    for (const [id, amount] of Object.entries(source)) this.give(id, amount);
    return this;
  }

  /** Zrzut {id: ile} — do zapisu stanu i UI. */
  toObject() {
    const out = {};
    for (const [id, amount] of this._counts) {
      if (amount > 0) out[id] = amount;
    }
    return out;
  }

  /** Pary [id, ile], posortowane po id — stabilna kolejność w UI. */
  entries() {
    return [...this._counts.entries()]
      .filter(([, amount]) => amount > 0)
      .sort((a, b) => a[0].localeCompare(b[0]));
  }
}

/** Tworzy inwentarz z dowolnego starego formatu (Set, tablica, obiekt). */
export function createWeaponInventory(source = null) {
  return source instanceof WeaponInventory ? source : new WeaponInventory(source);
}
