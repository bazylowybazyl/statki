const HEADER_WRITE = 0;
const HEADER_READ = 1;
const HEADER_DROPPED = 2;
const HEADER_SEQUENCE = 3;
const RING_HEADER_WORDS = 4;

function createBuffer(byteLength, shared) {
  if (shared && typeof SharedArrayBuffer === 'function') return new SharedArrayBuffer(byteLength);
  return new ArrayBuffer(byteLength);
}

function load(header, index, shared) {
  return shared ? Atomics.load(header, index) : header[index];
}

function store(header, index, value, shared) {
  if (shared) Atomics.store(header, index, value);
  else header[index] = value;
}

function add(header, index, value, shared) {
  if (shared) return Atomics.add(header, index, value);
  const previous = header[index];
  header[index] += value;
  return previous;
}

export class SpscFloat64Ring {
  constructor(options = {}) {
    this.capacity = Math.max(2, Number(options.capacity) | 0);
    this.stride = Math.max(1, Number(options.stride) | 0);
    const headerBytes = RING_HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT;
    const dataOffset = Math.ceil(headerBytes / Float64Array.BYTES_PER_ELEMENT) * Float64Array.BYTES_PER_ELEMENT;
    const byteLength = dataOffset + this.capacity * this.stride * Float64Array.BYTES_PER_ELEMENT;
    this.buffer = options.buffer || createBuffer(byteLength, options.shared !== false);
    this.shared = typeof SharedArrayBuffer === 'function' && this.buffer instanceof SharedArrayBuffer;
    this.header = new Int32Array(this.buffer, 0, RING_HEADER_WORDS);
    this.data = new Float64Array(this.buffer, dataOffset, this.capacity * this.stride);
    if (options.initialize !== false) this.reset();
  }

  reset() {
    this.header.fill(0);
    this.data.fill(0);
  }

  push(record) {
    const write = load(this.header, HEADER_WRITE, this.shared);
    const read = load(this.header, HEADER_READ, this.shared);
    const next = (write + 1) % this.capacity;
    if (next === read) {
      add(this.header, HEADER_DROPPED, 1, this.shared);
      return false;
    }
    const offset = write * this.stride;
    for (let field = 0; field < this.stride; field++) this.data[offset + field] = Number(record?.[field]) || 0;
    store(this.header, HEADER_WRITE, next, this.shared);
    add(this.header, HEADER_SEQUENCE, 1, this.shared);
    return true;
  }

  pop(out) {
    const read = load(this.header, HEADER_READ, this.shared);
    const write = load(this.header, HEADER_WRITE, this.shared);
    if (read === write) return false;
    const offset = read * this.stride;
    for (let field = 0; field < this.stride; field++) out[field] = this.data[offset + field];
    store(this.header, HEADER_READ, (read + 1) % this.capacity, this.shared);
    return true;
  }

  get size() {
    const write = load(this.header, HEADER_WRITE, this.shared);
    const read = load(this.header, HEADER_READ, this.shared);
    return write >= read ? write - read : this.capacity - read + write;
  }

  get dropped() {
    return load(this.header, HEADER_DROPPED, this.shared);
  }

  get sequence() {
    return load(this.header, HEADER_SEQUENCE, this.shared);
  }
}

export class TripleFloat32Buffer {
  constructor(options = {}) {
    this.length = Math.max(1, Number(options.length) | 0);
    const headerBytes = 4 * Int32Array.BYTES_PER_ELEMENT;
    const dataOffset = Math.ceil(headerBytes / Float32Array.BYTES_PER_ELEMENT) * Float32Array.BYTES_PER_ELEMENT;
    const byteLength = dataOffset + this.length * 3 * Float32Array.BYTES_PER_ELEMENT;
    this.buffer = options.buffer || createBuffer(byteLength, options.shared !== false);
    this.shared = typeof SharedArrayBuffer === 'function' && this.buffer instanceof SharedArrayBuffer;
    this.header = new Int32Array(this.buffer, 0, 4);
    this.data = new Float32Array(this.buffer, dataOffset, this.length * 3);
    this.pages = [
      this.data.subarray(0, this.length),
      this.data.subarray(this.length, this.length * 2),
      this.data.subarray(this.length * 2, this.length * 3)
    ];
    if (options.initialize !== false) this.reset();
  }

  reset() {
    this.header.fill(0);
    this.data.fill(0);
  }

  beginWrite() {
    const published = load(this.header, 0, this.shared);
    const pageIndex = (published + 1) % 3;
    return { pageIndex, page: this.pages[pageIndex] };
  }

  publish(pageIndex, tick = 0, count = 0) {
    store(this.header, 2, Number(tick) | 0, this.shared);
    store(this.header, 3, Number(count) | 0, this.shared);
    store(this.header, 0, pageIndex % 3, this.shared);
    add(this.header, 1, 1, this.shared);
  }

  readLatest() {
    const pageIndex = load(this.header, 0, this.shared);
    return {
      pageIndex,
      page: this.pages[pageIndex],
      sequence: load(this.header, 1, this.shared),
      tick: load(this.header, 2, this.shared),
      count: load(this.header, 3, this.shared)
    };
  }
}
