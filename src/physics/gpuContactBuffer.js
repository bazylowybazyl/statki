import { GPU_CONTACT_STRIDE, MAX_GPU_CONTACTS } from './protocol.js';

const HEADER_COUNT = 0;
const HEADER_OVERFLOW = 1;
const HEADER_TICK = 2;
const HEADER_SEQUENCE = 3;
const HEADER_DROPPED = 4;
const HEADER_WORDS = 8;

function createBuffer(byteLength, shared) {
  return shared && typeof SharedArrayBuffer === 'function'
    ? new SharedArrayBuffer(byteLength)
    : new ArrayBuffer(byteLength);
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

export class OverflowPairQueue {
  constructor(capacity = 512) {
    this.capacity = Math.max(1, Number(capacity) | 0);
    this.bodyA = new Uint32Array(this.capacity);
    this.bodyB = new Uint32Array(this.capacity);
    this.priority = new Uint16Array(this.capacity);
    this.count = 0;
    this.dropped = 0;
  }

  reset() {
    this.count = 0;
    this.dropped = 0;
  }

  push(bodyA, bodyB, priority = 1) {
    let a = Number(bodyA) >>> 0;
    let b = Number(bodyB) >>> 0;
    if (a > b) { const swap = a; a = b; b = swap; }
    for (let index = 0; index < this.count; index++) {
      if (this.bodyA[index] === a && this.bodyB[index] === b) {
        this.priority[index] = Math.max(this.priority[index], Number(priority) | 0);
        return true;
      }
    }
    if (this.count >= this.capacity) {
      this.dropped++;
      return false;
    }
    const index = this.count++;
    this.bodyA[index] = a;
    this.bodyB[index] = b;
    this.priority[index] = Math.max(1, Number(priority) | 0);
    return true;
  }
}

export class GpuContactBuffer {
  constructor(options = {}) {
    this.capacity = Math.max(1, Number(options.capacity) | 0 || MAX_GPU_CONTACTS);
    this.stride = GPU_CONTACT_STRIDE;
    const headerBytes = HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT;
    const dataOffset = Math.ceil(headerBytes / 64) * 64;
    const byteLength = dataOffset + this.capacity * this.stride * Uint32Array.BYTES_PER_ELEMENT;
    this.buffer = options.buffer || createBuffer(byteLength, options.shared === true);
    this.shared = typeof SharedArrayBuffer === 'function' && this.buffer instanceof SharedArrayBuffer;
    this.header = new Int32Array(this.buffer, 0, HEADER_WORDS);
    this.u32 = new Uint32Array(this.buffer, dataOffset, this.capacity * this.stride);
    this.f32 = new Float32Array(this.buffer, dataOffset, this.capacity * this.stride);
    this.overflowPairs = new OverflowPairQueue(options.overflowPairCapacity || 512);
    if (options.initialize !== false) this.reset();
  }

  reset() {
    this.header.fill(0);
    this.u32.fill(0);
    this.overflowPairs.reset();
  }

  beginWrite(tickId) {
    store(this.header, HEADER_COUNT, 0, this.shared);
    store(this.header, HEADER_OVERFLOW, 0, this.shared);
    store(this.header, HEADER_TICK, Number(tickId) | 0, this.shared);
    this.overflowPairs.reset();
  }

  push(record) {
    const count = load(this.header, HEADER_COUNT, this.shared);
    if (count >= this.capacity) {
      store(this.header, HEADER_OVERFLOW, 1, this.shared);
      add(this.header, HEADER_DROPPED, 1, this.shared);
      this.overflowPairs.push(record?.bodyA, record?.bodyB, 2);
      return false;
    }
    const base = count * this.stride;
    this.u32[base] = Number(record?.bodyA) >>> 0;
    this.u32[base + 1] = Number(record?.bodyB) >>> 0;
    this.u32[base + 2] = Number(record?.shardA) >>> 0;
    this.u32[base + 3] = Number(record?.shardB) >>> 0;
    this.u32[base + 4] = Number(record?.tickId ?? this.tickId) >>> 0;
    this.u32[base + 5] = Number(record?.revisionA) >>> 0;
    this.u32[base + 6] = Number(record?.revisionB) >>> 0;
    this.u32[base + 7] = Number(record?.flags) >>> 0;
    this.f32[base + 8] = Number(record?.toi) || 0;
    this.f32[base + 9] = Number(record?.pointX) || 0;
    this.f32[base + 10] = Number(record?.pointY) || 0;
    this.f32[base + 11] = Number(record?.normalX) || 0;
    this.f32[base + 12] = Number(record?.normalY) || 0;
    this.f32[base + 13] = Math.max(0, Number(record?.penetration) || 0);
    this.f32[base + 14] = Number(record?.relativeSpeed) || 0;
    this.f32[base + 15] = 0;
    store(this.header, HEADER_COUNT, count + 1, this.shared);
    return true;
  }

  publish() {
    add(this.header, HEADER_SEQUENCE, 1, this.shared);
  }

  readRecord(index, out) {
    const count = this.count;
    if (index < 0 || index >= count || !out) return false;
    const base = index * this.stride;
    out.bodyA = this.u32[base];
    out.bodyB = this.u32[base + 1];
    out.shardA = this.u32[base + 2];
    out.shardB = this.u32[base + 3];
    out.tickId = this.u32[base + 4];
    out.revisionA = this.u32[base + 5];
    out.revisionB = this.u32[base + 6];
    out.flags = this.u32[base + 7];
    out.toi = this.f32[base + 8];
    out.pointX = this.f32[base + 9];
    out.pointY = this.f32[base + 10];
    out.normalX = this.f32[base + 11];
    out.normalY = this.f32[base + 12];
    out.penetration = this.f32[base + 13];
    out.relativeSpeed = this.f32[base + 14];
    return true;
  }

  validate(index, expectedTick, revisionForBody) {
    if (index < 0 || index >= this.count) return false;
    const base = index * this.stride;
    if (this.u32[base + 4] !== (Number(expectedTick) >>> 0)) return false;
    if (typeof revisionForBody !== 'function') return true;
    return this.u32[base + 5] === (Number(revisionForBody(this.u32[base])) >>> 0) &&
      this.u32[base + 6] === (Number(revisionForBody(this.u32[base + 1])) >>> 0);
  }

  get count() { return load(this.header, HEADER_COUNT, this.shared); }
  get overflow() { return load(this.header, HEADER_OVERFLOW, this.shared) !== 0; }
  get tickId() { return load(this.header, HEADER_TICK, this.shared) >>> 0; }
  get sequence() { return load(this.header, HEADER_SEQUENCE, this.shared) >>> 0; }
  get dropped() { return load(this.header, HEADER_DROPPED, this.shared) >>> 0; }
  get memoryBytes() { return this.buffer.byteLength; }
}

