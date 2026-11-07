// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Compact's persistentHash, done fast. The runtime hashes a value as SHA-256
// over its atoms, each written little-endian at the full width its alignment
// gives (Uint<8> one byte, Uint<64> eight, Field and Bytes<32> thirty-two).
// The tests check this against @midnight-ntwrk/compact-runtime itself; the
// recovered values in a report are re-checked with the runtime too.

import { createHash, hash } from 'node:crypto';

// crypto.hash (one-shot, a little faster) returns a Buffer only on newer Node releases.
const oneShot = (() => {
  try {
    return Buffer.isBuffer(hash('sha256', Buffer.alloc(0), 'buffer' as never));
  } catch {
    return false;
  }
})();

/** SHA-256 of an already-aligned preimage: what persistentHash computes. */
export function sha256(preimage: Uint8Array): Buffer {
  if (oneShot) return hash('sha256', preimage, 'buffer' as never) as unknown as Buffer;
  return createHash('sha256').update(preimage).digest();
}

/** `value` little-endian in `width` bytes (an atom at full width). */
export function le(value: bigint | number, width: number): Buffer {
  const b = Buffer.alloc(width);
  let v = BigInt(value);
  for (let i = 0; i < width && v > 0n; i++) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
}

/** Compact's pad(32, s): the UTF-8 bytes of s, zero-filled to 32. */
export function pad32(s: string): Buffer {
  const b = Buffer.alloc(32);
  const raw = Buffer.from(s, 'utf8');
  if (raw.length > 32) throw new Error(`pad(32, "${s}"): longer than 32 bytes`);
  raw.copy(b);
  return b;
}

/** The first 6 bytes of a 32-byte value as a number: a cheap key for lookups. */
export function key48(h: Uint8Array): number {
  return h[0] + h[1] * 2 ** 8 + h[2] * 2 ** 16 + h[3] * 2 ** 24 + h[4] * 2 ** 32 + h[5] * 2 ** 40;
}

export const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
