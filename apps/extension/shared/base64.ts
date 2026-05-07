/**
 * Base64 ↔ ArrayBuffer helpers used to ferry binary payloads through
 * `browser.runtime.sendMessage`, which JSON-serializes everything.
 */

const CHUNK_SIZE = 0x80_00;

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    // `apply` is materially faster than `...spread` once chunks are this big.
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + CHUNK_SIZE) as unknown as Array<number>
    );
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
