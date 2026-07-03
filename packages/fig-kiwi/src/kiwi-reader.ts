/** Sequential reader for Kiwi-encoded bytes; mirrors `KiwiWriter`. */
export class KiwiReader {
  private readonly bytes: Uint8Array;
  private offset: number;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.offset = 0;
  }

  get done(): boolean {
    return this.offset >= this.bytes.length;
  }

  byte(): number {
    const value = this.bytes[this.offset];
    if (value === undefined) {
      throw new Error(`Read past end of buffer at offset ${this.offset}`);
    }
    this.offset += 1;
    return value;
  }

  bool(): boolean {
    return this.byte() !== 0;
  }

  uint(): number {
    // Little-endian 7-bit groups; multiplication instead of shifts so values
    // above 2^31 survive (the writer uses float math the same way).
    let value = 0;
    let multiplier = 1;
    for (;;) {
      const b = this.byte();
      value += (b & 127) * multiplier;
      if ((b & 128) === 0) {
        return value;
      }
      multiplier *= 128;
    }
  }

  uint64(): number {
    return this.uint();
  }

  int(): number {
    // Zigzag decoding
    const encoded = this.uint();
    return encoded % 2 === 0 ? encoded / 2 : -((encoded - 1) / 2) - 1;
  }

  int64(): number {
    return this.int();
  }

  float(): number {
    // The writer emits a single 0 byte for 0.0, otherwise 4 bytes of the
    // bit-rotated IEEE 754 representation.
    const first = this.byte();
    if (first === 0) {
      return 0;
    }
    let bits =
      first | (this.byte() << 8) | (this.byte() << 16) | (this.byte() << 24);
    bits >>>= 0;

    // Reverse the writer's rotation: bits = (orig >>> 23) | (orig << 9)
    bits = ((bits << 23) | (bits >>> 9)) >>> 0;

    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setUint32(0, bits, false);
    return view.getFloat32(0, false);
  }

  string(): string {
    const start = this.offset;
    let end = start;
    while (end < this.bytes.length && this.bytes[end] !== 0) {
      end += 1;
    }
    if (end >= this.bytes.length) {
      throw new Error(`Unterminated string starting at offset ${start}`);
    }
    const value = new TextDecoder().decode(this.bytes.subarray(start, end));
    this.offset = end + 1;
    return value;
  }

  rawBytes(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) {
      throw new Error(
        `Read of ${length} bytes past end of buffer at offset ${this.offset}`
      );
    }
    const value = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
}
